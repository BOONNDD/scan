// workers/orchestrator.js
// Worker lifecycle, dispatch, restart, and timeout discipline.
//
// Architecture:
//   Spawns a Blob-based Worker from `QR.workers.SOURCE`. Maintains a
//   pending-message map keyed by monotonic message id, with per-call timeout.
//   On `error` or `terminate`, restarts the worker and rejects all
//   pending calls so callers can decide to retry.
//
//   Public API:
//     dispatch(op, payload, transferList) → Promise<result>
//     isReady()
//
// Optimization:
//   - Single worker; the runtime's compute load is modest.
//   - Transferable ArrayBuffers avoid structured-clone cost.
//
// Failure handling:
//   - Per-call timeout (default 1500 ms) rejects stuck calls.
//   - Worker crash triggers a single respawn with backoff; consecutive
//     crashes trip degraded mode.
//
// Telemetry:
//   - `workers.dispatch_total`
//   - `workers.dispatch_failed`
//   - `workers.dispatch_timeout`
//   - `workers.restarts`
//   - `workers.in_flight` gauge
//
// Integration:
//   Used by predict/sequence_inference.js.
//
// Latency:
//   One postMessage + worker compute + return; transferables avoid clones.
//
// Memory:
//   Pending map sized by in-flight calls.
//
// Survivability:
//   The orchestrator falls into degraded mode rather than throwing on
//   the main thread.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.workers && QR.workers.dispatch) return;

  const TIMEOUT_MS = 1500;
  const MAX_RESTARTS_PER_MIN = 5;
  let worker = null;
  let blobUrl = null;
  let nextId = 1;
  let restartsLastMinute = [];
  let degraded = false;
  const pending = new Map();   // id → { resolve, reject, op, t0, timer }

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function gauge(name)  { const m = QR.metrics; return m ? m.gauge(name) : { set() {} }; }

  function attach() {
    if (!QR.workers || !QR.workers.SOURCE) return false;
    try {
      const blob = new Blob([QR.workers.SOURCE], { type: 'application/javascript' });
      blobUrl = URL.createObjectURL(blob);
      worker = new W.Worker(blobUrl);
      worker.onmessage = onMessage;
      worker.onerror   = onError;
      QR.bus.emit('workers.ready', {});
      return true;
    } catch (e) {
      degraded = true;
      QR.bus.emit('workers.unavailable', { reason: String(e && e.message || e) });
      return false;
    }
  }

  function onMessage(ev) {
    const msg = ev.data || {};
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    gauge('workers.in_flight').set(pending.size);
    if (p.timer) W.clearTimeout(p.timer);
    if (msg.ok) {
      p.resolve(msg.result);
    } else {
      metric('workers.dispatch_failed').inc();
      p.reject(new Error(msg.error || 'worker_error'));
    }
  }

  function onError(/* ev */) {
    metric('workers.dispatch_failed').inc();
    restart('error');
  }

  function tooManyRestarts() {
    const now = performance.now();
    restartsLastMinute = restartsLastMinute.filter((t) => now - t < 60_000);
    return restartsLastMinute.length >= MAX_RESTARTS_PER_MIN;
  }

  function restart(reason) {
    metric('workers.restarts').inc();
    if (tooManyRestarts()) {
      degraded = true;
      QR.bus.emit('workers.degraded', { reason });
      return;
    }
    restartsLastMinute.push(performance.now());
    try { if (worker) worker.terminate(); } catch (_) {}
    try { if (blobUrl) URL.revokeObjectURL(blobUrl); } catch (_) {}
    worker = null; blobUrl = null;
    // Reject all pending calls.
    pending.forEach((p) => { try { p.reject(new Error('worker_restart')); } catch (_) {} });
    pending.clear();
    gauge('workers.in_flight').set(0);
    QR.scheduler.defer(() => attach(), 100, 'workers.respawn');
  }

  function dispatch(op, payload, transferList) {
    metric('workers.dispatch_total').inc();
    if (degraded || !worker) {
      return Promise.reject(new Error('worker_unavailable'));
    }
    const id = nextId++;
    const t0 = performance.now();
    return new Promise((resolve, reject) => {
      const timer = W.setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        gauge('workers.in_flight').set(pending.size);
        metric('workers.dispatch_timeout').inc();
        reject(new Error('worker_timeout'));
      }, TIMEOUT_MS);
      pending.set(id, { resolve, reject, op, t0, timer });
      gauge('workers.in_flight').set(pending.size);
      try {
        worker.postMessage({ id, op, payload }, transferList || []);
      } catch (e) {
        pending.delete(id);
        gauge('workers.in_flight').set(pending.size);
        W.clearTimeout(timer);
        reject(e);
      }
    });
  }

  function isReady() { return !!worker && !degraded; }

  function init() {
    attach();
  }

  function shutdown() {
    try { if (worker) worker.terminate(); } catch (_) {}
    try { if (blobUrl) URL.revokeObjectURL(blobUrl); } catch (_) {}
    worker = null; blobUrl = null;
  }

  QR.workers.dispatch = dispatch;
  QR.workers.isReady  = isReady;
  if (QR.kernel) QR.kernel.register('workers.orchestrator', init, shutdown);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
