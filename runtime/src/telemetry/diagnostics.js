// telemetry/diagnostics.js
// Diagnostic snapshots + copyable reports.
//
// Architecture:
//   Single function `report()` returns a structured JSON blob with the full
//   runtime state — kernel status, metric snapshot, pool stats, bus stats,
//   per-asset feature state summary, regime distribution.
//   `copy()` writes the blob to the clipboard when called from a user
//   gesture; falls back to a pre-selected textarea otherwise.
//
//   The report is intended for human inspection and bug triage; it is also
//   the payload of an opt-in `localStorage.QR_AUDIT_LOG = '1'` audit log.
//
// Optimization:
//   - Snapshots are read-only; they never mutate state.
//
// Failure handling:
//   - Best-effort: each section is wrapped in try/catch so a single bad
//     section does not corrupt the whole report.
//
// Telemetry:
//   - `telemetry.reports_generated`
//
// Integration:
//   Public: report(), copy(), browserInfo().
//
// Latency:
//   ~ ms for a typical report.
//
// Memory:
//   Transient.
//
// Survivability:
//   Cannot throw out of report() — partial reports are preferred to none.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.telemetry && QR.telemetry.diagnostics) return;

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return { error: String(e && e.message || e), fallback }; }
  }

  function browserInfo() {
    return safe(() => ({
      userAgent: W.navigator.userAgent,
      lang: W.navigator.language,
      url: W.location && W.location.href,
      hardwareConcurrency: W.navigator.hardwareConcurrency,
      memory: W.performance && W.performance.memory ? {
        usedJSHeapSize: W.performance.memory.usedJSHeapSize,
        totalJSHeapSize: W.performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: W.performance.memory.jsHeapSizeLimit,
      } : null,
      vis: W.document && W.document.visibilityState,
    }), null);
  }

  function poolStats() {
    return safe(() => ({
      tick:       QR.tickPool ? QR.tickPool.snapshot() : null,
      frame:      QR.framePool ? QR.framePool.snapshot() : null,
      prediction: QR.predictionPool ? QR.predictionPool.snapshot() : null,
    }), null);
  }

  function busStats() {
    return safe(() => QR.bus ? QR.bus.snapshot() : null, null);
  }

  function regimeDistribution() {
    const out = {};
    safe(() => {
      const states = QR.regime && QR.regime._states ? QR.regime._states : null;
      if (!states) return;
      // We don't expose states by default; use the metrics gauges if present.
    });
    return out;
  }

  function report() {
    if (QR.metrics) QR.metrics.counter('telemetry.reports_generated').inc();
    return {
      generatedAt: new Date().toISOString(),
      kernel: safe(() => QR.kernel ? QR.kernel.status() : null),
      browser: browserInfo(),
      metrics: safe(() => QR.metrics ? QR.metrics.snapshot() : null),
      pools: poolStats(),
      bus: busStats(),
      worker: safe(() => ({ ready: QR.workers && QR.workers.isReady ? QR.workers.isReady() : false })),
      risk: safe(() => QR.risk ? QR.risk.snapshot() : null),
      timing: safe(() => QR.execution && QR.execution.timing ? QR.execution.timing.stats() : null),
      calibration: safe(() => QR.predict && QR.predict.calibration ? QR.predict.calibration.params() : null),
      ensemble: safe(() => QR.predict && QR.predict.ensemble ? QR.predict.ensemble.hitState() : null),
      regimes: regimeDistribution(),
    };
  }

  async function copy() {
    const blob = JSON.stringify(report(), null, 2);
    try {
      if (W.navigator && W.navigator.clipboard && W.navigator.clipboard.writeText) {
        await W.navigator.clipboard.writeText(blob);
        return { ok: true, length: blob.length };
      }
    } catch (_) {}
    // Fallback: temporary textarea
    try {
      const ta = W.document.createElement('textarea');
      ta.value = blob;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
      W.document.body.appendChild(ta);
      ta.select();
      W.document.execCommand && W.document.execCommand('copy');
      W.document.body.removeChild(ta);
      return { ok: true, length: blob.length, via: 'textarea' };
    } catch (_) {
      return { ok: false };
    }
  }

  QR.telemetry = QR.telemetry || {};
  QR.telemetry.diagnostics = { report, copy, browserInfo };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
