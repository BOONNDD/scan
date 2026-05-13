// risk/risk_engine.js
// Fractional Kelly + streak compression + drawdown suppression + regime gate.
//
// Architecture:
//   The risk engine answers one question per prediction:
//     "Given this calibrated probability, current regime, recent outcomes,
//      and drawdown state, what fraction of bankroll should we expose, if any?"
//   It is consulted by execution/pipeline.js after calibration and before
//   timing.
//
//   Components:
//     - Fractional Kelly: f = (p·(1+payout) − 1) / payout, scaled by `kellyMul`.
//     - Streak compression: loss streaks shrink exposure geometrically.
//     - Drawdown suppression: total drawdown beyond `ddCap` halts trading.
//     - Regime gate: regimes {unstable, manipulation_like, dead_market, warmup}
//       block; {volatile, reversal_prone} apply a haircut.
//
// Optimization:
//   - All state is scalars or a tiny ring of recent results.
//   - One arithmetic chain per assessment.
//
// Failure handling:
//   - On stream-stall flag set by the watchdog, every assessment returns 0.
//   - On `clock.jump`, exposure halves for the next cooldown window.
//
// Telemetry:
//   - `risk.exposure_pct` gauge
//   - `risk.blocks.<reason>` counter
//   - `risk.drawdown_pct` gauge
//   - `risk.streak_losses` gauge
//
// Integration:
//   Public: assess(prediction, ctx) → { allow, fraction, reason }.
//   Subscribes: `execution.result` for win/loss accounting; `clock.jump`,
//   `ingest.stalled` for halt flags.
//
// Latency:
//   < 1 µs.
//
// Memory:
//   Small fixed.
//
// Survivability:
//   Stateful but bounded; resets on snapshot restore.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.risk) return;

  const CFG = {
    kellyMul: 0.50,         // fractional Kelly multiplier (½ Kelly — V12-like)
    payoutDefault: 0.80,    // 80% — overridable per asset via setPayout()
    minProbEdge: 0.52,      // pCal must exceed this (V12 was ~0.51)
    ddCap: 0.25,            // 25% peak-to-trough → halt
    streakCap: 5,           // 5 losses in a row → halt for cooldown
    streakShrink: 0.6,      // per recent loss
    haircutVolatile: 0.5,
    haircutReversal: 0.7,
    cooldownAfterStallMs: 30_000,
    cooldownAfterJumpMs: 10_000,
    historyWindow: 64,
  };

  const state = {
    bankroll: 1,            // normalized; UI may rescale
    peakBankroll: 1,
    streakLosses: 0,
    lastResultAt: 0,
    haltedUntil: 0,
    payoutByAsset: new Map(),
  };
  const history = new QR.RingBuffer(CFG.historyWindow); // {win, pCal}

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function gauge(name)  { const m = QR.metrics; return m ? m.gauge(name) : { set() {} }; }

  function setPayout(asset, payoutFraction) {
    if (!asset || !Number.isFinite(payoutFraction)) return;
    state.payoutByAsset.set(asset, Math.max(0.1, Math.min(2, payoutFraction)));
  }
  function getPayout(asset) {
    return state.payoutByAsset.get(asset) || CFG.payoutDefault;
  }

  function kellyFraction(p, payout) {
    if (p <= 0.5 || payout <= 0) return 0;
    const f = (p * (1 + payout) - 1) / payout;
    return f > 0 ? f : 0;
  }

  function drawdown() {
    return state.peakBankroll > 0 ? (1 - state.bankroll / state.peakBankroll) : 0;
  }

  function assess(pred) {
    const now = performance.now();
    const reasons = [];
    const reject = (why) => { metric('risk.blocks.' + why).inc(); return { allow: false, fraction: 0, reason: why }; };

    if (!pred || pred.direction === 0) return reject('no_direction');
    if (now < state.haltedUntil) return reject('halted');
    if (pred.regime === 'warmup' || pred.regime === 'unstable' ||
        pred.regime === 'dead_market' || pred.regime === 'manipulation_like') {
      return reject('regime_' + pred.regime);
    }
    if (pred.pCal < CFG.minProbEdge) return reject('low_prob');
    if (drawdown() >= CFG.ddCap) {
      state.haltedUntil = now + 5 * 60_000;
      return reject('drawdown_cap');
    }
    if (state.streakLosses >= CFG.streakCap) {
      state.haltedUntil = now + 60_000;
      return reject('streak_cap');
    }

    const payout = getPayout(pred.asset);
    let f = kellyFraction(pred.pCal, payout) * CFG.kellyMul;

    // Streak compression
    if (state.streakLosses > 0) f *= Math.pow(CFG.streakShrink, state.streakLosses);

    // Regime haircuts
    if (pred.regime === 'volatile') f *= CFG.haircutVolatile;
    else if (pred.regime === 'reversal_prone') f *= CFG.haircutReversal;

    f = Math.max(0, Math.min(0.05, f));   // hard cap 5% per trade

    gauge('risk.exposure_pct').set(f);
    gauge('risk.drawdown_pct').set(drawdown());
    gauge('risk.streak_losses').set(state.streakLosses);

    if (f <= 1e-4) return reject('fraction_too_small');
    return { allow: true, fraction: f, reason: 'ok', payout };
  }

  function recordResult(r) {
    if (!r) return;
    history.push({ win: !!r.win, pCal: r.pCal });
    const stake = r.fraction || 0;
    if (r.win) {
      state.bankroll *= (1 + stake * (r.payout || CFG.payoutDefault));
      state.streakLosses = 0;
    } else {
      state.bankroll *= (1 - stake);
      state.streakLosses++;
    }
    if (state.bankroll > state.peakBankroll) state.peakBankroll = state.bankroll;
    state.lastResultAt = performance.now();
    gauge('risk.bankroll').set(state.bankroll);
    gauge('risk.drawdown_pct').set(drawdown());
    QR.bus.emit('risk.result', { ...r, bankroll: state.bankroll, drawdown: drawdown() });
  }

  function init() {
    QR.bus.on('execution.result', recordResult);
    QR.bus.on('clock.jump', () => {
      state.haltedUntil = Math.max(state.haltedUntil, performance.now() + CFG.cooldownAfterJumpMs);
    });
    QR.bus.on('ingest.stalled', () => {
      state.haltedUntil = Math.max(state.haltedUntil, performance.now() + CFG.cooldownAfterStallMs);
    });
  }

  function configure(opts) {
    if (!opts) return;
    if (Number.isFinite(+opts.kellyMul))     CFG.kellyMul     = Math.max(0.01, Math.min(1.0,  +opts.kellyMul));
    if (Number.isFinite(+opts.minProbEdge))  CFG.minProbEdge  = Math.max(0.50, Math.min(0.95, +opts.minProbEdge));
    if (Number.isFinite(+opts.ddCap))        CFG.ddCap        = Math.max(0.05, Math.min(0.80, +opts.ddCap));
    if (Number.isFinite(+opts.streakCap))    CFG.streakCap    = Math.max(1,    Math.min(20,   +opts.streakCap | 0));
    QR.bus.emit('risk.configured', getConfig());
  }
  function getConfig() {
    return {
      kellyMul: CFG.kellyMul, minProbEdge: CFG.minProbEdge,
      ddCap: CFG.ddCap, streakCap: CFG.streakCap,
    };
  }
  function resetHalt() { state.haltedUntil = 0; }

  QR.risk = {
    assess, recordResult, setPayout, getPayout, drawdown,
    configure, getConfig, resetHalt,
    state: () => ({ ...state, payoutByAsset: undefined }),
    snapshot: () => ({ bankroll: state.bankroll, peak: state.peakBankroll, streak: state.streakLosses }),
    restore: (snap) => {
      if (!snap) return;
      if (Number.isFinite(snap.bankroll)) state.bankroll = snap.bankroll;
      if (Number.isFinite(snap.peak))     state.peakBankroll = snap.peak;
      if (Number.isFinite(snap.streak))   state.streakLosses = snap.streak;
    },
  };
  if (QR.kernel) QR.kernel.register('risk.engine', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
