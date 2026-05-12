// dom/self_healing.js
// Selector registry with fallback chains + mutation-driven cache invalidation.
//
// Architecture:
//   The runtime treats every DOM lookup as a *named* selector with an
//   ordered fallback chain. The registry caches a resolved Element until:
//     - it is detached, or
//     - a MutationObserver fires on the document root, or
//     - the actuator explicitly requests invalidation after a failed click.
//   When all fallbacks fail, the registry emits `dom.unresolved` and the
//   pipeline gates execution.
//
//   Selectors for Higher/Lower buttons are seeded from the legacy V12's
//   battle-tested list and extended with text-content matchers for the
//   Arabic UI.
//
// Optimization:
//   - One MutationObserver, configured with the smallest subtree needed.
//   - Resolution is O(chain) only when cache is cold; otherwise O(1).
//
// Failure handling:
//   - On `resolve` returning null, the registry rebinds on the next idle
//     callback. Repeated failure → degraded mode.
//
// Telemetry:
//   - `dom.resolutions_total`
//   - `dom.resolutions_failed`
//   - `dom.rebinds`
//   - `dom.mutations_observed`
//
// Integration:
//   Public: register(name, chain), resolve(name), invalidate(name?).
//   Used by execution/dom_actuator.js.
//
// Latency:
//   Cached resolve: O(1) plus an `isConnected` check.
//
// Memory:
//   Small Map of names → resolution.
//
// Survivability:
//   Even when the DOM is hostile, the registry keeps trying without ever
//   throwing.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.dom && QR.dom.selfHealing) return;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }

  const registry = new Map();   // name → { chain, cached, lastBoundAt }
  let observer = null;
  let mutationsBudget = 0;

  function register(name, chain) {
    if (!Array.isArray(chain) || chain.length === 0) return;
    registry.set(name, { chain, cached: null, lastBoundAt: 0 });
  }

  function tryOne(spec) {
    try {
      if (typeof spec === 'string') {
        return W.document.querySelector(spec);
      }
      if (spec && typeof spec === 'object') {
        if (spec.id) return W.document.getElementById(spec.id);
        if (spec.css) return W.document.querySelector(spec.css);
        if (spec.text) {
          const sel = spec.scope || '[class],[data-side],button,[role="button"]';
          const nodes = W.document.querySelectorAll(sel);
          for (let i = 0; i < nodes.length; i++) {
            const t = (nodes[i].textContent || '').trim();
            if (spec.exact ? t === spec.text : t.indexOf(spec.text) >= 0) return nodes[i];
          }
        }
      }
    } catch (_) {}
    return null;
  }

  function isAttached(el) {
    return !!(el && el.isConnected !== false && W.document.contains && W.document.contains(el));
  }

  function resolve(name) {
    const rec = registry.get(name);
    if (!rec) return null;
    metric('dom.resolutions_total').inc();
    if (rec.cached && isAttached(rec.cached)) return rec.cached;

    for (let i = 0; i < rec.chain.length; i++) {
      const el = tryOne(rec.chain[i]);
      if (el) {
        rec.cached = el;
        rec.lastBoundAt = performance.now();
        return el;
      }
    }
    metric('dom.resolutions_failed').inc();
    QR.bus.emit('dom.unresolved', { name });
    return null;
  }

  function invalidate(name) {
    metric('dom.rebinds').inc();
    if (name) {
      const r = registry.get(name);
      if (r) r.cached = null;
    } else {
      registry.forEach((r) => { r.cached = null; });
    }
  }

  function startObserver() {
    if (observer || typeof W.MutationObserver !== 'function' || !W.document || !W.document.body) {
      // Body not ready yet; retry later.
      QR.scheduler.defer(startObserver, 250, 'dom.observer.retry');
      return;
    }
    observer = new W.MutationObserver(() => {
      mutationsBudget++;
      // Throttle invalidations — invalidate at most once per 250 ms.
      if (mutationsBudget === 1) {
        QR.scheduler.defer(() => {
          metric('dom.mutations_observed').inc(mutationsBudget);
          mutationsBudget = 0;
          invalidate();
        }, 250, 'dom.observer.flush');
      }
    });
    try {
      observer.observe(W.document.body, { childList: true, subtree: true, attributes: false });
    } catch (_) {}
  }

  function seed() {
    register('btn.higher', [
      '[data-side="call"]',
      '.call-btn',
      '.quick-hl-call',
      '.btn-call',
      'button.action-high-low.button-call-wrap',
      'a.btn-call',
      { text: 'أعلى' },
      { text: 'Higher' },
    ]);
    register('btn.lower', [
      '[data-side="put"]',
      '.put-btn',
      '.quick-hl-put',
      '.btn-put',
      'button.action-high-low.button-put-wrap',
      'a.btn-put',
      { text: 'أدنى' },
      { text: 'Lower' },
    ]);
  }

  function init() {
    seed();
    startObserver();
  }

  QR.dom = QR.dom || {};
  QR.dom.selfHealing = { register, resolve, invalidate };
  if (QR.kernel) QR.kernel.register('dom.selfHealing', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
