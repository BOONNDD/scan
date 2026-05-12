// _bootstrap.js
// Final entry — installs the WS interceptor immediately at document-start,
// then defers module boot until the page has begun loading so DOM-dependent
// modules can register without spinning.
//
// Architecture:
//   - Guard against double-install.
//   - Install the WS interceptor before any platform code runs.
//   - Schedule kernel.boot() on next microtask so all modules in the
//     bundle have had a chance to register.
//   - Mount the HUD if localStorage opts in.
//
// Survivability:
//   The bootstrap itself never throws — any error during boot falls back
//   to a no-op runtime that still exposes diagnostics.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.__booted) return;
  QR.__booted = true;

  // Install the WS hook as early as possible — before the platform's scripts
  // open their sockets. The other modules (parser, validator, normalizer)
  // are already wired via the kernel registry; we just need ws_interceptor.
  try {
    if (QR.ingest && QR.ingest.ws) QR.ingest.ws.install();
  } catch (_) {}

  // Kernel boot on next microtask so any straggler registrations land first.
  queueMicrotask(() => {
    try {
      if (QR.kernel) QR.kernel.boot();
    } catch (_) {}
  });

  // Console banner — single line, opt-out-able by silencing the bus.
  try {
    // eslint-disable-next-line no-console
    console.info('%cQuantum Runtime V13%c booted', 'color:#7df;font-weight:bold', 'color:inherit');
  } catch (_) {}
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
