// _bootstrap.js
// Final entry — installs the WS interceptor at document-start, mounts an
// immediately-visible boot banner so the user can verify injection, then
// boots the kernel on next microtask.
//
// Visible boot banner:
//   The banner attaches to document.documentElement (which is always
//   available at @run-at document-start, unlike document.body) so the user
//   sees "Quantum Runtime V13 — LOADED" the moment the userscript runs.
//   The banner auto-fades after 4 s; the control panel takes over after that.
//
// Survivability:
//   The bootstrap itself never throws. Banner / kernel boot are both
//   wrapped in try/catch. If everything else fails, the banner still
//   confirms injection.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.__booted) return;
  QR.__booted = true;
  QR.__bootedAt = Date.now();

  // 1. Install the WS hook synchronously — must happen before platform scripts open sockets.
  let wsOk = false;
  try {
    if (QR.ingest && QR.ingest.ws) {
      QR.ingest.ws.install();
      wsOk = !QR.ingest.ws.isDegraded();
    }
  } catch (_) {}

  // 2. Drop an immediate, prominent boot banner so injection is visible.
  //    document.documentElement always exists at @run-at document-start.
  function mountBanner() {
    try {
      if (!W.document || !W.document.documentElement) return;
      if (W.document.getElementById('__qr_boot_banner__')) return;
      const b = W.document.createElement('div');
      b.id = '__qr_boot_banner__';
      b.textContent = 'Quantum Runtime V13 · LOADED' + (wsOk ? '' : ' (no WS)');
      b.style.cssText = [
        'position:fixed', 'top:8px', 'right:8px', 'z-index:2147483647',
        'background:rgba(10,40,20,0.92)', 'color:#7df', 'border:1px solid #2a4',
        'padding:6px 12px', 'border-radius:6px', 'pointer-events:none',
        'font:12px/1.3 ui-monospace,Menlo,Consolas,monospace',
        'box-shadow:0 4px 16px rgba(0,0,0,.5)',
        'opacity:1', 'transition:opacity 600ms ease-out',
      ].join(';');
      W.document.documentElement.appendChild(b);
      // Auto-fade after 4 s; remove after 5 s. The control panel button stays.
      W.setTimeout(() => { try { b.style.opacity = '0'; } catch (_) {} }, 4000);
      W.setTimeout(() => { try { b.parentNode && b.parentNode.removeChild(b); } catch (_) {} }, 5000);
    } catch (_) {}
  }
  // Mount immediately if we can; otherwise on DOMContentLoaded.
  if (W.document && W.document.documentElement) mountBanner();
  else {
    try {
      W.document.addEventListener('readystatechange', function once() {
        mountBanner();
        W.document.removeEventListener('readystatechange', once);
      });
    } catch (_) {}
  }

  // 3. Kernel boot on next microtask so any straggler registrations land first.
  queueMicrotask(() => {
    try { if (QR.kernel) QR.kernel.boot(); } catch (_) {}
  });

  // 4. Console banner — distinct prefix so logs are easy to filter.
  try {
    // eslint-disable-next-line no-console
    console.info('%c[QR]%c Quantum Runtime V13 booted · ws=' + (wsOk ? 'ok' : 'degraded'),
      'background:#274;color:#7df;padding:1px 4px;border-radius:3px;font-weight:bold',
      'color:inherit');
  } catch (_) {}
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

