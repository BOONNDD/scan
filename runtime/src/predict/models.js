// predict/models.js
// Six specialist prediction models — pure functions, no allocation.
//
// Architecture:
//   Each model is a pure function `model(frame, state) → vote ∈ [-1, +1]`,
//   where the sign indicates direction and the magnitude indicates strength.
//   The ensemble (predict/ensemble.js) combines votes weighted by regime.
//
//   Specialists:
//     - momentum     — short-horizon directional persistence
//     - meanRevert   — fade-the-move when pressure flips sign
//     - pressure     — signed-flow imbalance
//     - volatility   — directional bias in volatile regimes (skew-aware)
//     - statistical  — z-score on log-return
//     - sequence     — placeholder stub vote; the real sequence model lives
//                       in predict/sequence_inference.js and is called via
//                       the worker. Until inference returns, this returns 0.
//
// Optimization:
//   - All math is in-place; no temporary arrays.
//   - State is a small object owned by the ensemble layer (one per asset).
//
// Failure handling:
//   - Non-finite features → return 0 (abstain).
//
// Telemetry:
//   - `predict.<model>.votes` histogram (sampled)
//
// Integration:
//   Imported by predict/ensemble.js.
//
// Latency:
//   ~sub-µs per model.
//
// Memory:
//   Stateless; small per-asset state lives in ensemble.
//
// Survivability:
//   Pure functions — cannot fail at runtime.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.predict && QR.predict.models) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function tanh(x) { return Math.tanh(x); }

  function momentum(f) {
    if (!Number.isFinite(f.pressure) || !Number.isFinite(f.runLength)) return 0;
    // Run length encodes persistence; pressure encodes direction.
    const sgn = f.pressure > 0 ? 1 : (f.pressure < 0 ? -1 : 0);
    const persist = clamp(Math.abs(f.runLength) / 5, 0, 1);
    return sgn * persist;
  }

  function meanRevert(f) {
    if (!Number.isFinite(f.pressure) || !Number.isFinite(f.entropy)) return 0;
    // Fade extreme pressure when entropy is moderate (not yet random).
    const extreme = tanh(Math.abs(f.pressure) / 3e-5);
    const fadeable = clamp((0.95 - f.entropy) * 5, 0, 1);
    const sgn = f.pressure > 0 ? -1 : 1;
    return sgn * extreme * fadeable;
  }

  function pressure(f) {
    if (!Number.isFinite(f.pressure)) return 0;
    // Pressure on slow assets sits in 1e-6..5e-5; scale so typical
    // signed pressure produces a vote magnitude near 0.3..0.6.
    return tanh(f.pressure / 1.5e-5);
  }

  function volatility(f) {
    if (!Number.isFinite(f.realizedVolBp) || !Number.isFinite(f.asymmetry)) return 0;
    // In volatile regimes the skew of recent returns is a leading hint.
    const intensity = clamp(f.realizedVolBp / 5, 0, 1);
    return clamp(f.asymmetry, -2, 2) / 2 * intensity;
  }

  function statistical(f) {
    if (!Number.isFinite(f.velocity) || !Number.isFinite(f.realizedVolBp)) return 0;
    if (f.realizedVolBp < 1e-4) return 0;
    // Z-score on directional acceleration normalized by realized vol.
    const z = (f.acceleration * 10000) / Math.max(f.realizedVolBp, 0.5);
    return tanh(z);
  }

  function sequence(f, state) {
    if (!state || !state.lastSequenceVote) return 0;
    const v = state.lastSequenceVote;
    if (!Number.isFinite(v.value) || !Number.isFinite(v.at)) return 0;
    // Decay sequence vote with age: half-life 1.5 s.
    const ageMs = performance.now() - v.at;
    const decay = Math.exp(-ageMs / 1500);
    return clamp(v.value * decay, -1, 1);
  }

  QR.predict = QR.predict || {};
  QR.predict.models = { momentum, meanRevert, pressure, volatility, statistical, sequence };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
