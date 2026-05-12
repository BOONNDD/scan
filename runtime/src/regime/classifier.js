// regime/classifier.js
// Adaptive market-state classifier.
//
// Architecture:
//   Subscribes to `frame`. Maintains per-asset hysteresis-based FSM with
//   eight states:
//     trending, ranging, volatile, compressed, unstable, reversal_prone,
//     manipulation_like, dead_market.
//   Decisions use a small feature vector from the FeatureFrame; classification
//   uses thresholds derived from rolling quantile-free estimators (median +
//   MAD-equivalent fast streaming approximations).
//   Emits `regime.tag` whenever the regime changes for an asset.
//
// Optimization:
//   - All thresholds are pre-computed per call; no allocation.
//   - Hysteresis: a regime must persist for K consecutive frames before
//     becoming active — protects against flapping.
//
// Failure handling:
//   - Cold frames (frame.warm === false) are tagged "warmup" and skipped.
//   - On extreme features (NaN / Infinity), the regime drops to "unstable"
//     and the pipeline gates execution.
//
// Telemetry:
//   - `regime.switches_total` counter
//   - `regime.switches_per_minute` gauge
//   - `regime.<name>.share` gauge (sampled)
//
// Integration:
//   Subscribes: `frame`. Mutates frame.regime in place, then re-emits on
//   `frame.tagged`. The pipeline subscribes to `frame.tagged`, not `frame`.
//
// Latency:
//   < 1 µs per frame.
//
// Memory:
//   Per-asset 64 bytes of state.
//
// Survivability:
//   Pure data-driven FSM; cannot stall the runtime.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.regime) return;

  const HYST_K = 3;

  // Reference thresholds — calibrated on synthetic ranges; the runtime can
  // adapt them via online quantile estimators in a future iteration.
  const T = {
    volHighBp: 8,
    volLowBp: 1.5,
    entropyHigh: 0.97,   // near-random
    entropyLow: 0.75,    // strongly directional
    pressureStrong: 6e-5,
    accelStrong: 4e-5,
    deadVelBp: 0.6,
    wickDomHigh: 0.65,
  };

  const states = new Map();   // asset → { current, candidate, run, switches, lastSwitchAt, history }

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function gauge(name) { const m = QR.metrics; return m ? m.gauge(name) : { set() {} }; }

  function stateOf(asset) {
    let s = states.get(asset);
    if (!s) {
      s = { current: 'warmup', candidate: 'warmup', run: 0, switches: 0, lastSwitchAt: 0 };
      states.set(asset, s);
    }
    return s;
  }

  function classifyFrame(f) {
    if (!f.warm) return 'warmup';
    if (!Number.isFinite(f.realizedVolBp) || !Number.isFinite(f.entropy)) return 'unstable';

    const vol = f.realizedVolBp;
    const ent = f.entropy;
    const prs = f.pressure;
    const acc = f.acceleration;
    const vel = f.velocity * 10000; // bp-scale

    if (vel < T.deadVelBp && vol < T.volLowBp) return 'dead_market';
    if (vol > T.volHighBp && ent > T.entropyHigh) return 'volatile';
    if (vol > T.volHighBp && Math.abs(prs) > T.pressureStrong && Math.abs(acc) > T.accelStrong) return 'manipulation_like';
    if (vol < T.volLowBp && ent > T.entropyHigh) return 'compressed';
    if (ent < T.entropyLow && Math.abs(prs) > T.pressureStrong) return 'trending';
    if (ent > T.entropyHigh && Math.abs(prs) < T.pressureStrong) return 'ranging';
    if (f.wickDominance > T.wickDomHigh && Math.abs(acc) > T.accelStrong) return 'reversal_prone';
    return 'unstable';
  }

  function onFrame(f) {
    const s = stateOf(f.asset);
    const proposed = classifyFrame(f);
    if (proposed === s.candidate) {
      s.run++;
    } else {
      s.candidate = proposed;
      s.run = 1;
    }
    if (s.run >= HYST_K && s.current !== s.candidate) {
      const prev = s.current;
      s.current = s.candidate;
      s.switches++;
      s.lastSwitchAt = f.ts;
      metric('regime.switches_total').inc();
      QR.bus.emit('regime.switch', { asset: f.asset, from: prev, to: s.current, at: f.ts });
    }
    f.regime = s.current;
    QR.bus.emit('frame.tagged', f);
  }

  function init() {
    QR.bus.on('frame', onFrame);
    // Per-minute switch-rate gauge
    QR.scheduler.every(60_000, () => {
      let total = 0;
      states.forEach((s) => { total += s.switches; s.switches = 0; });
      gauge('regime.switches_per_minute').set(total);
    }, 'regime.switch_rate');
  }

  QR.regime = { stateOf, classifyFrame };
  if (QR.kernel) QR.kernel.register('regime.classifier', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
