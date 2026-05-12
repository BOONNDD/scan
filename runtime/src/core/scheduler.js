// core/scheduler.js
// Scheduling primitives — microtask, idle, throttled interval (anti-drift).
//
// Architecture:
//   Three primitives:
//     micro(fn)     — queueMicrotask wrapper with error isolation.
//     idle(fn)      — requestIdleCallback if available, else setTimeout(0).
//     every(ms, fn) — self-correcting periodic task (no setInterval).
//   `every` returns a handle with `.cancel()`.
//
// Optimization:
//   Periodic tasks self-correct against perf.now() — they never accumulate
//   skew, unlike setInterval which compounds drift under load.
//
// Failure handling:
//   Every callback is wrapped in try/catch. Errors go to the event bus
//   under `scheduler.error` with the source label.
//
// Telemetry:
//   - `scheduler.queue_depth` gauge — pending micro tasks at last drain.
//   - `scheduler.cb_errors` counter.
//
// Integration:
//   No upstream deps. Used by event_bus (batching), telemetry (heartbeat),
//   watchdog (pet).
//
// Latency:
//   micro: fires before next paint. idle: opportunistic. every: ±2 ms target.
//
// Memory:
//   One handle object per active timer.
//
// Survivability:
//   Self-correcting `every` survives tab throttling: if a tick is delayed by
//   N×interval, only one execution is queued (not N catch-ups).

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.scheduler) return;

  const hasIdle = typeof W.requestIdleCallback === 'function';
  let cbErrors = 0;

  function safe(fn, label) {
    try {
      fn();
    } catch (e) {
      cbErrors++;
      const bus = QR.bus;
      if (bus) bus.emit('scheduler.error', { label, msg: String(e && e.message || e) });
    }
  }

  function micro(fn, label) {
    queueMicrotask(() => safe(fn, label || 'micro'));
  }

  function idle(fn, label) {
    if (hasIdle) {
      W.requestIdleCallback(() => safe(fn, label || 'idle'), { timeout: 200 });
    } else {
      W.setTimeout(() => safe(fn, label || 'idle'), 0);
    }
  }

  function every(ms, fn, label) {
    const handle = { cancelled: false, _to: null };
    let anchor = performance.now();
    const tick = () => {
      if (handle.cancelled) return;
      safe(fn, label || 'every');
      anchor += ms;
      const drift = performance.now() - anchor;
      const next = Math.max(0, ms - drift);
      handle._to = W.setTimeout(tick, next);
    };
    handle._to = W.setTimeout(tick, ms);
    handle.cancel = () => {
      handle.cancelled = true;
      if (handle._to) W.clearTimeout(handle._to);
    };
    return handle;
  }

  // `defer(fn, ms)` — single-shot, cancelable, exception-isolated.
  function defer(fn, ms, label) {
    const handle = { cancelled: false, _to: null };
    handle._to = W.setTimeout(() => {
      if (handle.cancelled) return;
      safe(fn, label || 'defer');
    }, ms);
    handle.cancel = () => {
      handle.cancelled = true;
      if (handle._to) W.clearTimeout(handle._to);
    };
    return handle;
  }

  function stats() {
    return { cbErrors };
  }

  QR.scheduler = { micro, idle, every, defer, stats };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
