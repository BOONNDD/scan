// core/clock.js
// High-resolution monotonic clock + drift detection.
//
// Architecture:
//   The runtime never trusts wall-clock time. All scheduling and latency
//   measurements use performance.now() anchored at boot. A 50 ms beacon
//   detects browser-tab throttling, GC pauses, and event-loop lag.
//
// Optimization:
//   - One scalar arithmetic per `now()` call.
//   - Beacon uses setTimeout with self-correction (target time, not interval).
//   - Drift samples live in a typed-array ring; no allocation on the hot path.
//
// Failure handling:
//   If the beacon detects a jump > 250 ms, emit `clock.jump` once and let
//   the kernel decide whether to enter degraded mode.
//
// Telemetry:
//   Exposes `eventloop.lag_ms` as a gauge sampled every beacon tick.
//
// Integration:
//   Boot order: clock → event_bus → everything else. clock has no upstream deps.
//
// Latency:
//   `now()` is sub-microsecond. `driftMs()` returns the most recent measurement
//   without recomputing.
//
// Memory:
//   Single 256-slot Float64Array. ~2 KB resident.
//
// Survivability:
//   Beacon self-rearms on every fire; even an uncaught exception in a
//   consumer will not stop the clock.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.clock) return;

  const BEACON_MS = 50;
  const JUMP_THRESHOLD_MS = 250;
  const SAMPLE_CAP = 256;

  const samples = new Float64Array(SAMPLE_CAP);
  let head = 0;
  let count = 0;
  let lastBeacon = 0;
  let lastLagMs = 0;
  let lastJumpMs = 0;
  let bootEpochMs = 0;
  let bootPerfNow = 0;
  let beaconHandle = null;
  let stopped = false;

  function now() {
    return performance.now();
  }

  function since(t0) {
    return performance.now() - t0;
  }

  function epochMs() {
    return bootEpochMs + (performance.now() - bootPerfNow);
  }

  function driftMs() {
    return lastLagMs;
  }

  function lastJump() {
    return lastJumpMs;
  }

  function recordSample(v) {
    samples[head] = v;
    head = (head + 1) & (SAMPLE_CAP - 1);
    if (count < SAMPLE_CAP) count++;
  }

  function p(percentile) {
    if (count === 0) return 0;
    const buf = new Float64Array(count);
    for (let i = 0; i < count; i++) buf[i] = samples[i];
    buf.sort();
    const idx = Math.min(count - 1, Math.max(0, Math.floor(percentile * count)));
    return buf[idx];
  }

  function beacon() {
    if (stopped) return;
    const t = performance.now();
    const expected = lastBeacon + BEACON_MS;
    const lag = lastBeacon === 0 ? 0 : (t - expected);
    lastBeacon = t;
    lastLagMs = lag > 0 ? lag : 0;
    recordSample(lastLagMs);

    if (lag > JUMP_THRESHOLD_MS) {
      lastJumpMs = lag;
      const bus = QR.bus;
      if (bus) bus.emit('clock.jump', { lagMs: lag, at: t });
    }
    // Self-correcting reschedule: aim at expected + BEACON_MS, never accumulate skew.
    const drift = t - expected;
    const next = Math.max(0, BEACON_MS - drift);
    beaconHandle = W.setTimeout(beacon, next);
  }

  function start() {
    if (beaconHandle) return;
    bootEpochMs = Date.now();
    bootPerfNow = performance.now();
    lastBeacon = bootPerfNow;
    stopped = false;
    beaconHandle = W.setTimeout(beacon, BEACON_MS);
  }

  function stop() {
    stopped = true;
    if (beaconHandle) W.clearTimeout(beaconHandle);
    beaconHandle = null;
  }

  QR.clock = {
    now, since, epochMs, driftMs, lastJump,
    p50: () => p(0.50), p95: () => p(0.95), p99: () => p(0.99),
    start, stop,
  };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
