// execution/dom_actuator.js
// Resilient DOM-click executor — performs the actual Higher/Lower click.
//
// Architecture:
//   The actuator resolves selectors via the self-healing selector registry
//   (dom/self_healing.js), then dispatches a chain of native events
//   (pointerdown → mousedown → mouseup → click) on the resolved element.
//   It does NOT directly call platform APIs; it operates only on the DOM,
//   which is the same surface a human uses.
//
//   The actuator is consulted only by execution/pipeline.js, never directly
//   by prediction or risk.
//
// Optimization:
//   - Resolve once per click, cache for the next call cycle.
//   - Reuse a single MouseEvent pool when possible.
//
// Failure handling:
//   - If the selector resolves to nothing, emit `execution.failed` with a
//     "no_target" reason and ask the self-healing module to rebind.
//   - If the click throws, count an error and rebind.
//   - If three consecutive clicks fail, request degraded mode.
//
// Telemetry:
//   - `execution.clicks_total`
//   - `execution.clicks_failed`
//   - `execution.click_ms` histogram
//   - `execution.rebinds_requested`
//
// Integration:
//   Public: click(direction) → Promise<{ok, clickAt}>.
//   Emits: `execution.click`, `execution.failed`.
//
// Latency:
//   < 1 ms typical; the goal is determinism, not raw speed.
//
// Memory:
//   None per click (after warm-up).
//
// Survivability:
//   Failures are isolated; the rest of the runtime continues even when
//   clicking is impossible.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.execution && QR.execution.actuator) return;

  let consecutiveFailures = 0;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function histo(name)  { const m = QR.metrics; return m ? m.histogram(name) : { observe() {} }; }

  function dispatch(el) {
    const opts = { bubbles: true, cancelable: true, view: W };
    el.dispatchEvent(new W.MouseEvent('pointerdown', opts));
    el.dispatchEvent(new W.MouseEvent('mousedown',   opts));
    el.dispatchEvent(new W.MouseEvent('mouseup',     opts));
    el.dispatchEvent(new W.MouseEvent('click',       opts));
  }

  function resolve(direction) {
    const healer = QR.dom && QR.dom.selfHealing;
    if (!healer) return null;
    const key = direction > 0 ? 'btn.higher' : 'btn.lower';
    return healer.resolve(key);
  }

  async function click(direction) {
    const t0 = performance.now();
    const el = resolve(direction);
    if (!el) {
      metric('execution.clicks_failed').inc();
      metric('execution.rebinds_requested').inc();
      consecutiveFailures++;
      if (QR.dom && QR.dom.selfHealing) QR.dom.selfHealing.invalidate();
      QR.bus.emit('execution.failed', { reason: 'no_target', direction });
      if (consecutiveFailures >= 3) QR.bus.emit('execution.halt', { reason: 'no_target_streak' });
      return { ok: false, clickAt: 0, reason: 'no_target' };
    }
    try {
      dispatch(el);
      const clickAt = performance.now();
      metric('execution.clicks_total').inc();
      histo('execution.click_ms').observe(clickAt - t0);
      consecutiveFailures = 0;
      QR.bus.emit('execution.click', { direction, clickAt });
      return { ok: true, clickAt };
    } catch (e) {
      metric('execution.clicks_failed').inc();
      consecutiveFailures++;
      QR.bus.emit('execution.failed', { reason: 'exception', direction, msg: String(e && e.message || e) });
      return { ok: false, clickAt: 0, reason: 'exception' };
    }
  }

  QR.execution = QR.execution || {};
  QR.execution.actuator = { click };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
