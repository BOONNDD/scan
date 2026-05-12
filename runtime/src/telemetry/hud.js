// telemetry/hud.js
// Optional debug overlay — opt-in HUD showing live runtime state.
//
// Architecture:
//   Mounts a single absolute-positioned div in the page; refreshes once per
//   second using requestIdleCallback. The HUD is hidden by default and can
//   be toggled by setting `localStorage.QR_HUD = '1'` or calling
//   `QR.telemetry.hud.toggle()`. The HUD reads from `QR.metrics.snapshot()`
//   and the kernel status; it never holds long references.
//
// Optimization:
//   - One DOM container; updates via textContent only (no re-render).
//   - Updates only when the tab is visible.
//
// Failure handling:
//   - If document.body is unavailable, defer mount.
//   - If rendering throws, the HUD silently disables itself.
//
// Telemetry:
//   - `telemetry.hud.renders`
//
// Integration:
//   Public: mount(), toggle(), unmount().
//
// Latency:
//   Updates ≤ 1 ms.
//
// Memory:
//   One element; ~few hundred bytes of text per render.
//
// Survivability:
//   HUD failure cannot affect the runtime.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.telemetry && QR.telemetry.hud) return;

  let host = null;
  let visible = false;
  let intervalH = null;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }

  function ensureHost() {
    if (host) return host;
    if (!W.document || !W.document.body) return null;
    host = W.document.createElement('div');
    host.id = '__qr_hud__';
    host.style.cssText = [
      'position:fixed', 'right:8px', 'bottom:8px', 'z-index:2147483647',
      'background:rgba(10,12,16,0.86)', 'color:#cfe0ff', 'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace',
      'padding:8px 10px', 'border:1px solid #2a4', 'border-radius:6px',
      'max-width:380px', 'pointer-events:none', 'white-space:pre-wrap',
      'box-shadow:0 4px 16px rgba(0,0,0,.4)',
    ].join(';');
    host.textContent = 'QR · booting…';
    W.document.body.appendChild(host);
    return host;
  }

  function render() {
    metric('telemetry.hud.renders').inc();
    if (!host || W.document.hidden) return;
    try {
      const k = QR.kernel ? QR.kernel.status() : { booted: false };
      const m = QR.metrics ? QR.metrics.snapshot() : { counters: {}, gauges: {}, histograms: {} };
      const c = m.counters;
      const g = m.gauges;
      const h = m.histograms;
      const lines = [];
      lines.push('QR  · ' + (k.booted ? 'up' : 'down') +
                 '   loaded=' + k.loaded.length +
                 '   degraded=' + (k.degraded.length));
      lines.push('ticks ' + (c['ingest.normalizer.ticks_total'] || 0) +
                 '   frames ' + (c['features.frames_emitted'] || 0) +
                 '   preds ' + (c['predict.ensemble.emits'] || 0));
      lines.push('clicks ' + (c['execution.clicks_total'] || 0) +
                 '   fail ' + (c['execution.clicks_failed'] || 0) +
                 '   in-flight ' + (g['pipeline.in_flight'] || 0));
      const claHist = h['execution.click_to_ack_ms'] || { p50: 0, p95: 0 };
      lines.push('click→ack  p50=' + claHist.p50.toFixed(1) + 'ms  p95=' + claHist.p95.toFixed(1) + 'ms');
      lines.push('regime sw/min ' + ((g['regime.switches_per_minute'] || 0).toFixed(0)) +
                 '   loop_lag ' + (QR.clock ? QR.clock.driftMs().toFixed(0) : '?') + 'ms');
      lines.push('bankroll ' + ((g['risk.bankroll'] || 1).toFixed(4)) +
                 '   dd ' + ((g['risk.drawdown_pct'] || 0) * 100).toFixed(1) + '%' +
                 '   streak ' + (g['risk.streak_losses'] || 0));
      lines.push('cal a=' + ((g['predict.calibration.a'] || 1).toFixed(2)) +
                 '  b=' + ((g['predict.calibration.b'] || 0).toFixed(2)) +
                 '  drift ' + ((g['predict.calibration.drift'] || 0).toFixed(2)));
      host.textContent = lines.join('\n');
    } catch (_) {
      // disable HUD on error
      unmount();
    }
  }

  function mount() {
    ensureHost();
    visible = true;
    if (host) host.style.display = 'block';
    if (!intervalH) intervalH = QR.scheduler.every(1000, render, 'hud.render');
  }
  function unmount() {
    visible = false;
    if (host) host.style.display = 'none';
    if (intervalH) { intervalH.cancel(); intervalH = null; }
  }
  function toggle() { visible ? unmount() : mount(); }
  function isVisible() { return visible; }

  function init() {
    try {
      if (W.localStorage && W.localStorage.getItem('QR_HUD') === '1') {
        QR.scheduler.defer(mount, 1000, 'hud.boot');
      }
    } catch (_) {}
  }

  QR.telemetry = QR.telemetry || {};
  QR.telemetry.hud = { mount, unmount, toggle, isVisible };
  if (QR.kernel) QR.kernel.register('telemetry.hud', init, unmount);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
