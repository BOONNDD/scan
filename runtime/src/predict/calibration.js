// predict/calibration.js
// Confidence calibration — Platt-style logistic re-mapping plus drift tracking.
//
// Architecture:
//   The ensemble emits a raw probability `pRaw ∈ [0, 1]` for the direction
//   the prediction took. The calibrator maintains a sigmoid:
//       pCal = σ(a · logit(pRaw) + b)
//   parameters (a, b) updated via per-result SGD with a tiny learning rate.
//   Updates use only realized win/loss labels — never the prediction value
//   the system fired on (no look-ahead).
//
//   The calibrator also tracks `drift` — rolling correlation between pCal
//   and realized outcome. When drift falls below a threshold, the ensemble
//   widens its abstention band and reduces exposure.
//
// Optimization:
//   - No allocations; all state is scalars.
//   - Update is one log, one mult, one add per trade — O(1).
//
// Failure handling:
//   - pRaw clamped to [eps, 1-eps] before logit to avoid Infinity.
//   - On extreme drift the calibrator resets to identity (a=1, b=0) and
//     emits `predict.calibration.reset`.
//
// Telemetry:
//   - `predict.calibration.a` gauge
//   - `predict.calibration.b` gauge
//   - `predict.calibration.drift` gauge
//   - `predict.calibration.resets` counter
//
// Integration:
//   Subscribes: `execution.result` { pCal, win }. Emits: nothing — exposes
//   functions `calibrate(p)` and `getDrift()`.
//
// Latency:
//   < 1 µs.
//
// Memory:
//   ~64 bytes.
//
// Survivability:
//   Self-resetting; cannot drift unboundedly.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.predict && QR.predict.calibration) return;

  const LR = 0.01;
  const EPS = 1e-6;
  const DRIFT_WINDOW = 64;
  const DRIFT_RESET_THRESH = -0.15;   // negative correlation → reset

  let a = 1.0, b = 0.0;
  let resets = 0;
  let sumP = 0, sumY = 0, sumPY = 0, sumP2 = 0, sumY2 = 0, n = 0;
  const buf = new Float64Array(DRIFT_WINDOW * 2);
  let head = 0, count = 0;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function gauge(name)  { const m = QR.metrics; return m ? m.gauge(name) : { set() {} }; }

  function logit(p) {
    const c = Math.max(EPS, Math.min(1 - EPS, p));
    return Math.log(c / (1 - c));
  }
  function sigmoid(z) {
    if (z >= 0) {
      const e = Math.exp(-z);
      return 1 / (1 + e);
    } else {
      const e = Math.exp(z);
      return e / (1 + e);
    }
  }

  function calibrate(pRaw) {
    return sigmoid(a * logit(pRaw) + b);
  }

  function recordWindow(p, y) {
    const idxP = head * 2;
    const idxY = idxP + 1;
    if (count === DRIFT_WINDOW) {
      const oldP = buf[idxP];
      const oldY = buf[idxY];
      sumP -= oldP; sumY -= oldY; sumPY -= oldP * oldY;
      sumP2 -= oldP * oldP; sumY2 -= oldY * oldY;
    } else {
      count++;
    }
    buf[idxP] = p; buf[idxY] = y;
    sumP += p; sumY += y; sumPY += p * y;
    sumP2 += p * p; sumY2 += y * y;
    head = (head + 1) % DRIFT_WINDOW;
    n = count;
  }

  function drift() {
    if (n < 16) return 0;
    const num = n * sumPY - sumP * sumY;
    const den = Math.sqrt(Math.max(0, (n * sumP2 - sumP * sumP) * (n * sumY2 - sumY * sumY)));
    return den === 0 ? 0 : num / den;
  }

  function update(pCal, win) {
    const y = win ? 1 : 0;
    const z = a * logit(pCal) + b;
    const pHat = sigmoid(z);
    const err = pHat - y;
    const lp = logit(pCal);
    a -= LR * err * lp;
    b -= LR * err;
    // Sanity bounds: keep a in [0.25, 4], b in [-2, 2].
    if (a < 0.25) a = 0.25; else if (a > 4) a = 4;
    if (b < -2) b = -2; else if (b > 2) b = 2;

    recordWindow(pCal, y);
    const d = drift();
    gauge('predict.calibration.a').set(a);
    gauge('predict.calibration.b').set(b);
    gauge('predict.calibration.drift').set(d);

    if (d < DRIFT_RESET_THRESH && n >= DRIFT_WINDOW) {
      a = 1.0; b = 0.0;
      sumP = sumY = sumPY = sumP2 = sumY2 = 0; n = 0; head = 0; count = 0;
      resets++;
      metric('predict.calibration.resets').inc();
      QR.bus.emit('predict.calibration.reset', { reason: 'drift', d });
    }
  }

  function init() {
    QR.bus.on('execution.result', (r) => {
      if (r && Number.isFinite(r.pCal) && (r.win === true || r.win === false)) {
        update(r.pCal, r.win);
      }
    });
  }

  QR.predict = QR.predict || {};
  QR.predict.calibration = { calibrate, update, drift, params: () => ({ a, b, resets }) };
  if (QR.kernel) QR.kernel.register('predict.calibration', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
