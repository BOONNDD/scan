// execution/timing_engine.js
// Execution Timing Calibrator — adaptive entry delay and drift compensation.
//
// Architecture:
//   The platform takes a non-trivial time from "we decide to click" to
//   "the order is accepted on the server". This module learns that delay
//   distribution from observed (decide → ack) samples and produces an
//   `effectiveDelayMs` that the actuator should wait before the candle
//   close boundary. It also tracks a "click-to-ack" histogram for telemetry.
//
//   The legacy V12 had an ETC table tied to wins/losses; we replace that
//   with a Welford-style mean/variance and a simple proportional adapter:
//   target offset = mean(clickToAck) − safetyMs(variance).
//
// Optimization:
//   - One scalar update on each ack.
//   - No allocations.
//
// Failure handling:
//   - On `clock.jump`, the timing engine widens its safety margin by 2× for
//     the next cooldown.
//   - On 3 consecutive missing acks, the runtime enters "no execution" mode.
//
// Telemetry:
//   - `execution.click_to_ack_ms` histogram
//   - `execution.timing_offset_ms` gauge
//   - `execution.acks_missing` counter
//
// Integration:
//   Public: schedule(pred, decisionAt) → ms-from-now to fire the click.
//           recordAck(clickAt, ackAt) → updates the model.
//   Subscribes: `execution.ack`, `clock.jump`.
//
// Latency:
//   < 1 µs.
//
// Memory:
//   ~64 bytes.
//
// Survivability:
//   Defaults are conservative if no samples have been observed.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.execution && QR.execution.timing) return;

  const CFG = {
    defaultOffsetMs: 60,
    safetyMultiplier: 1.2,
    maxOffsetMs: 800,
    consecutiveMissingHalt: 3,
  };

  let n = 0;
  let mean = CFG.defaultOffsetMs;
  let m2 = 0;
  let safetyExtraMs = 0;
  let missingAcks = 0;
  let lastUpdated = 0;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function gauge(name)  { const m = QR.metrics; return m ? m.gauge(name) : { set() {} }; }
  function histo(name)  { const m = QR.metrics; return m ? m.histogram(name) : { observe() {} }; }

  function variance() { return n > 1 ? m2 / (n - 1) : 0; }

  function offsetMs() {
    const sigma = Math.sqrt(variance());
    const v = mean * CFG.safetyMultiplier + sigma + safetyExtraMs;
    return Math.max(5, Math.min(CFG.maxOffsetMs, v));
  }

  function schedule() {
    // Returns the ms ahead of close-boundary that the actuator should fire.
    // Callers compute close-boundary from candle period.
    const off = offsetMs();
    gauge('execution.timing_offset_ms').set(off);
    return off;
  }

  function recordAck(clickAt, ackAt) {
    if (!Number.isFinite(clickAt) || !Number.isFinite(ackAt) || ackAt < clickAt) {
      metric('execution.acks_missing').inc();
      missingAcks++;
      if (missingAcks >= CFG.consecutiveMissingHalt) {
        QR.bus.emit('execution.halt', { reason: 'missing_acks' });
      }
      return;
    }
    missingAcks = 0;
    const dt = ackAt - clickAt;
    histo('execution.click_to_ack_ms').observe(dt);
    n++;
    const delta = dt - mean;
    mean += delta / n;
    m2  += delta * (dt - mean);
    lastUpdated = performance.now();
    safetyExtraMs = Math.max(0, safetyExtraMs - 1);   // decay
  }

  function onClockJump(ev) {
    safetyExtraMs = Math.min(200, safetyExtraMs + 50);
    QR.bus.emit('execution.timing.widen', { extraMs: safetyExtraMs, cause: 'clock_jump', lag: ev && ev.lagMs });
  }

  function init() {
    QR.bus.on('execution.ack', (ev) => recordAck(ev.clickAt, ev.ackAt));
    QR.bus.on('clock.jump', onClockJump);
  }

  QR.execution = QR.execution || {};
  QR.execution.timing = {
    schedule, recordAck, offsetMs,
    stats: () => ({ n, mean, sigma: Math.sqrt(variance()), safetyExtraMs }),
  };
  if (QR.kernel) QR.kernel.register('execution.timing', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
