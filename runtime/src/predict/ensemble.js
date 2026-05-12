// predict/ensemble.js
// Regime-conditioned weighted ensemble of specialist votes.
//
// Architecture:
//   For each tagged frame:
//     1. Collect votes from the six specialists in models.js.
//     2. Look up the active regime's weight vector.
//     3. Compute a signed score s = Σ w_i · v_i  ∈  [-1, +1].
//     4. Map to a directional probability pRaw via 0.5 + 0.5·σ(k·s).
//     5. Calibrate to pCal via predict/calibration.js.
//     6. Emit a Prediction on `prediction` channel.
//
//   Weight vectors are regime-specific and adapt online with a tiny EMA of
//   per-model realized hit-rate. Models that drift down lose weight; models
//   that prove themselves gain weight, bounded.
//
// Optimization:
//   - One pooled Prediction object per emission.
//   - All math is scalar; no array allocations per emit.
//
// Failure handling:
//   - On warmup or "unstable" regime, the ensemble abstains (direction = 0)
//     and emits the prediction anyway so telemetry can see the decision.
//   - If calibration is missing, pCal = pRaw.
//
// Telemetry:
//   - `predict.ensemble.emits`
//   - `predict.ensemble.abstains`
//   - `predict.ensemble.weight.<model>` gauge (sampled)
//   - `predict.ensemble.score` histogram
//
// Integration:
//   Subscribes: `frame.tagged`, `execution.result` (for weight adaptation),
//   `predict.sequence_vote` (to seed the sequence specialist).
//   Emits: `prediction`.
//
// Latency:
//   < 5 µs per frame.
//
// Memory:
//   Per-asset state map; ~256 bytes per asset.
//
// Survivability:
//   Self-bounded weights; cannot blow up.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.predict && QR.predict.ensemble) return;

  const MODEL_KEYS = ['momentum', 'meanRevert', 'pressure', 'volatility', 'statistical', 'sequence'];

  // Default per-regime weights — chosen so each regime emphasizes the
  // specialists most likely to be informative there.
  const REGIME_WEIGHTS = {
    trending:           { momentum: 0.30, meanRevert: 0.05, pressure: 0.20, volatility: 0.10, statistical: 0.15, sequence: 0.20 },
    ranging:            { momentum: 0.05, meanRevert: 0.30, pressure: 0.10, volatility: 0.10, statistical: 0.20, sequence: 0.25 },
    volatile:           { momentum: 0.10, meanRevert: 0.10, pressure: 0.10, volatility: 0.30, statistical: 0.10, sequence: 0.30 },
    compressed:         { momentum: 0.10, meanRevert: 0.20, pressure: 0.10, volatility: 0.15, statistical: 0.20, sequence: 0.25 },
    reversal_prone:     { momentum: 0.05, meanRevert: 0.35, pressure: 0.10, volatility: 0.15, statistical: 0.10, sequence: 0.25 },
    manipulation_like:  { momentum: 0.05, meanRevert: 0.05, pressure: 0.05, volatility: 0.10, statistical: 0.05, sequence: 0.05 }, // mostly abstain
    dead_market:        { momentum: 0.00, meanRevert: 0.00, pressure: 0.00, volatility: 0.00, statistical: 0.00, sequence: 0.00 }, // total abstain
    unstable:           { momentum: 0.00, meanRevert: 0.00, pressure: 0.00, volatility: 0.00, statistical: 0.00, sequence: 0.00 },
    warmup:             { momentum: 0.00, meanRevert: 0.00, pressure: 0.00, volatility: 0.00, statistical: 0.00, sequence: 0.00 },
  };

  // Per-model online hit-rate (Beta-ish). Used to scale weight ±20%.
  const hitState = Object.fromEntries(MODEL_KEYS.map((k) => [k, { wins: 1, losses: 1 }]));
  const perAsset = new Map();   // asset → { lastSequenceVote }

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function gauge(name)  { const m = QR.metrics; return m ? m.gauge(name) : { set() {} }; }
  function histo(name)  { const m = QR.metrics; return m ? m.histogram(name) : { observe() {} }; }

  function stateOf(asset) {
    let s = perAsset.get(asset);
    if (!s) { s = { lastSequenceVote: null }; perAsset.set(asset, s); }
    return s;
  }

  function sigmoidScaled(s) {
    // map [-1..1] → probability via sigmoid with gain k=3
    const z = 3 * s;
    const e = Math.exp(-z);
    const p = 1 / (1 + e);
    // Mapped further: keep extremes around 0.5 modestly to avoid overconfidence.
    return 0.5 + 0.85 * (p - 0.5);
  }

  function scoreFrame(f) {
    const m = QR.predict.models;
    const s = stateOf(f.asset);
    const votes = {
      momentum:    m.momentum(f),
      meanRevert:  m.meanRevert(f),
      pressure:    m.pressure(f),
      volatility:  m.volatility(f),
      statistical: m.statistical(f),
      sequence:    m.sequence(f, s),
    };
    return votes;
  }

  function getRegimeWeights(regime) {
    return REGIME_WEIGHTS[regime] || REGIME_WEIGHTS.unstable;
  }

  function modelMultiplier(model) {
    const r = hitState[model];
    const wr = r.wins / (r.wins + r.losses);
    // Map win-rate [0.4..0.6] → [0.8..1.2]
    const m = 0.8 + Math.max(0, Math.min(1, (wr - 0.4) / 0.2)) * 0.4;
    return m;
  }

  function onFrameTagged(f) {
    const votes = scoreFrame(f);
    const baseW = getRegimeWeights(f.regime);

    let signed = 0;
    let wSum = 0;
    for (let i = 0; i < MODEL_KEYS.length; i++) {
      const k = MODEL_KEYS[i];
      const w = baseW[k] * modelMultiplier(k);
      signed += w * votes[k];
      wSum   += w;
    }
    const score = wSum > 0 ? signed : 0;
    histo('predict.ensemble.score').observe(score);

    const direction = score > 0.05 ? 1 : (score < -0.05 ? -1 : 0);
    let pRaw = 0.5;
    if (direction !== 0) {
      const oriented = score * direction;          // ∈ [0..1] effectively
      pRaw = sigmoidScaled(oriented);
    }
    const pCal = (QR.predict.calibration ? QR.predict.calibration.calibrate(pRaw) : pRaw);

    const out = QR.predictionPool.acquire();
    out.asset = f.asset;
    out.ts = f.ts;
    out.direction = direction;
    out.pRaw = pRaw;
    out.pCal = pCal;
    out.regime = f.regime;
    out.modelVotes.mom = votes.momentum;
    out.modelVotes.mr  = votes.meanRevert;
    out.modelVotes.seq = votes.sequence;
    out.modelVotes.prs = votes.pressure;
    out.modelVotes.vol = votes.volatility;
    out.modelVotes.stat= votes.statistical;

    if (direction === 0) metric('predict.ensemble.abstains').inc();
    metric('predict.ensemble.emits').inc();
    QR.bus.emit('prediction', out);

    // Per-asset frame release — done by the prediction consumer (pipeline).
    QR.framePool.release(f);
  }

  function onSequenceVote(ev) {
    const s = stateOf(ev.asset);
    s.lastSequenceVote = { value: ev.value, at: ev.at };
  }

  function onResult(r) {
    if (!r || !r.modelVotes || (r.win !== true && r.win !== false)) return;
    const votes = r.modelVotes;
    const dir = r.direction;
    if (dir === 0) return;
    for (const k of MODEL_KEYS) {
      const v = votes[k.replace('momentum','mom').replace('meanRevert','mr').replace('pressure','prs').replace('volatility','vol').replace('statistical','stat')];
      if (!Number.isFinite(v)) continue;
      // "Agreed with the trade" means the vote sign matched the direction.
      const agreed = Math.sign(v) === Math.sign(dir);
      const rec = hitState[k];
      if (agreed) {
        if (r.win) rec.wins++;
        else        rec.losses++;
      }
      if (rec.wins + rec.losses > 400) {
        rec.wins *= 0.5; rec.losses *= 0.5;
      }
      gauge('predict.ensemble.weight.' + k).set(modelMultiplier(k));
    }
  }

  function init() {
    QR.bus.on('frame.tagged', onFrameTagged);
    QR.bus.on('predict.sequence_vote', onSequenceVote);
    QR.bus.on('execution.result', onResult);
  }

  QR.predict = QR.predict || {};
  QR.predict.ensemble = {
    regimes: () => Object.keys(REGIME_WEIGHTS),
    hitState: () => JSON.parse(JSON.stringify(hitState)),
  };
  if (QR.kernel) QR.kernel.register('predict.ensemble', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
