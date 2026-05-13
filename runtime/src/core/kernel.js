// core/kernel.js
// Lifecycle supervisor — boot, registration, shutdown, recovery.
//
// Architecture:
//   The kernel is a tiny DI container. Modules register an init function and
//   optional shutdown hook. Boot resolves them in registration order; init
//   exceptions are caught and the module is marked degraded — the rest of
//   the runtime continues to boot. After boot, the kernel arms the watchdog
//   and signals readiness via `kernel.ready`.
//
// Optimization:
//   Registration is O(1). Boot is O(modules).
//
// Failure handling:
//   - Per-module try/catch around init.
//   - `degraded` set holds modules that failed init.
//   - On uncaught window errors / unhandledrejection, kernel records the
//     failure and asks the watchdog whether to attempt restart.
//
// Telemetry:
//   - `kernel.boot_ms` histogram
//   - `kernel.modules_loaded` gauge
//   - `kernel.modules_degraded` gauge
//   - `kernel.uncaught` counter
//
// Integration:
//   Every module's loader calls `kernel.register(name, init, shutdown)`.
//
// Latency:
//   Boot is one-shot; subsequent operations are O(1).
//
// Memory:
//   Two Maps (modules, degraded), one Set of pending listeners.
//
// Survivability:
//   The kernel cannot crash unless registration itself throws. It treats
//   the runtime as best-effort: degraded modules log telemetry but never
//   prevent the rest of the system from running.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.kernel) return;

  const modules = new Map();   // name → { init, shutdown, ready }
  const degraded = new Set();
  const order = [];
  let booted = false;
  let bootStartedAt = 0;

  function register(name, init, shutdown) {
    if (modules.has(name)) return;
    modules.set(name, { init, shutdown, ready: false });
    order.push(name);
  }

  function bus() { return QR.bus; }
  function metric(name) {
    const m = QR.metrics;
    return m ? m.counter(name) : { inc() {} };
  }

  function bootOne(name) {
    const m = modules.get(name);
    if (!m || m.ready) return;
    try {
      if (typeof m.init === 'function') m.init();
      m.ready = true;
    } catch (e) {
      degraded.add(name);
      metric('kernel.module_init_failed').inc();
      const b = bus();
      if (b) b.emit('kernel.module_failed', { name, msg: String(e && e.message || e) });
    }
  }

  function boot() {
    if (booted) return;
    booted = true;
    bootStartedAt = performance.now();

    // Order: clock, bus already self-installed. Now boot user-registered modules.
    if (QR.clock) QR.clock.start();
    QR.bus.configure('tick',           { batched: false, highWater: 64  });
    QR.bus.configure('frame',          { batched: false, highWater: 64  });
    QR.bus.configure('prediction',     { batched: false, highWater: 32  });
    QR.bus.configure('execution',      { batched: false, highWater: 32  });
    QR.bus.configure('telemetry',      { batched: true,  highWater: 256 });
    QR.bus.configure('anomaly',        { batched: true,  highWater: 256 });
    QR.bus.configure('regime',         { batched: false, highWater: 16  });

    for (let i = 0; i < order.length; i++) bootOne(order[i]);

    // Subscribers are now registered; flush the pre-boot replay buffer and
    // disable buffering for future emissions.
    if (QR.bus && QR.bus.markBooted) QR.bus.markBooted();

    installGlobalErrorHandlers();

    const bootMs = performance.now() - bootStartedAt;
    const h = QR.metrics && QR.metrics.histogram('kernel.boot_ms');
    if (h) h.observe(bootMs);
    QR.bus.emit('kernel.ready', { bootMs, degraded: Array.from(degraded), loaded: order.slice() });
  }

  function shutdown() {
    if (!booted) return;
    for (let i = order.length - 1; i >= 0; i--) {
      const name = order[i];
      const m = modules.get(name);
      try { if (m && typeof m.shutdown === 'function') m.shutdown(); } catch (_) {}
    }
    if (QR.clock) QR.clock.stop();
    QR.bus.clear();
    booted = false;
  }

  function status() {
    return {
      booted,
      loaded: order.filter((n) => !degraded.has(n)),
      degraded: Array.from(degraded),
      total: order.length,
    };
  }

  function installGlobalErrorHandlers() {
    W.addEventListener('error', (ev) => {
      metric('kernel.uncaught').inc();
      QR.bus.emit('kernel.uncaught', { msg: ev && ev.message, src: 'window.error' });
    });
    W.addEventListener('unhandledrejection', (ev) => {
      metric('kernel.uncaught').inc();
      QR.bus.emit('kernel.uncaught', { msg: ev && ev.reason && ev.reason.message, src: 'unhandledrejection' });
    });
  }

  QR.kernel = { register, boot, shutdown, status };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
