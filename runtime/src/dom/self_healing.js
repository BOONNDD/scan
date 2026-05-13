// dom/self_healing.js
// Selector registry with the full V12 fallback chain + React-fiber walk +
// Arabic/English text matching.
//
// Architecture:
//   Resolution proceeds in three phases for Higher/Lower:
//     Phase 1 — fast CSS chain (~40 selectors per side, copied from V12).
//     Phase 2 — iterate every button/role=button, check React fiber direction
//               or visible Arabic/English text, prefer largest visible target.
//     Phase 3 — diagnostic: log the first 8 visible buttons so the user
//               can identify the right one when nothing matched.
//
//   Generic registrations (other selectors) still use the simple chain
//   model from the previous V13 design — phases 1–3 only apply to the
//   `btn.higher` / `btn.lower` resolutions.
//
// Optimization:
//   - Caches resolved Element until detached or until a MutationObserver
//     burst invalidates.
//   - Phase 2 is bounded by `document.querySelectorAll('button,...')` —
//     typically a few dozen nodes on PocketOption.
//
// Failure handling:
//   - All exceptions in selector tries are silenced.
//   - On three consecutive resolutions failing → emit `dom.unresolved` and
//     ask the actuator to enter degraded mode.
//
// Telemetry:
//   - dom.resolutions_total / resolutions_failed / rebinds / mutations_observed
//   - dom.resolutions_phase.<n>  (phase that succeeded)
//   - dom.fiber_hits / dom.text_hits
//
// Integration:
//   Public: resolve(name), invalidate(name?), register(name, chain).
//
// Latency:
//   Phase 1 cached resolve: O(1). Cold resolve: O(chain). Phase 2: O(buttons).
//
// Memory:
//   Small Map of names → resolution. No per-call allocation when cached.
//
// Survivability:
//   Never throws. Repeated misses produce telemetry, not exceptions.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.dom && QR.dom.selfHealing) return;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }

  const registry = new Map();        // name → { chain, cached, lastBoundAt }
  const cachedButtons = { call: null, put: null, at: 0 };
  const PHASE2_CACHE_MS = 1500;

  let observer = null;
  let mutationsBudget = 0;

  // V12's full CSS chain for the call/put buttons.
  const CALL_SELECTORS = [
    'button[class*="call"]:not([disabled])',          'button[class*="Call"]:not([disabled])',
    'button[class*="buy"]:not([disabled])',           'button[class*="Buy"]:not([disabled])',
    '[class*="deal-btn"][class*="call"]:not([disabled])',
    '[class*="deal-btn"][class*="up"]:not([disabled])',
    '[class*="dealBtn"][class*="call"]:not([disabled])',
    '[class*="button--call"]:not([disabled])',        '[class*="btn--call"]:not([disabled])',
    '[class*="trade__btn"][class*="call"]:not([disabled])',
    '[class*="trade-btn"][class*="call"]:not([disabled])',
    '[data-side="call"]:not([disabled])',             '[data-type="call"]:not([disabled])',
    '[data-direction="call"]:not([disabled])',        '[data-action="call"]:not([disabled])',
    '[data-side="up"]:not([disabled])',               '[data-type="up"]:not([disabled])',
    '[aria-label*="Higher"]:not([disabled])',         '[aria-label*="higher"]:not([disabled])',
    '[aria-label*="شراء"]:not([disabled])',            '[aria-label*="أعلى"]:not([disabled])',
    '[aria-label*="Call"]:not([disabled])',           '[aria-label*="Buy"]:not([disabled])',
    '[class*="call-button"]:not([disabled])',         '[class*="CallButton"]:not([disabled])',
    '[class*="quick-hl-call"]:not([disabled])',       '[class*="QuickHlCall"]:not([disabled])',
    '.btn-call', '[class*="btnCall"]', '#call-btn', '#buy-btn',
    '[class*="buy-btn"]', '[class*="buyBtn"]',        '[class*="tradeCall"]',
  ];
  const PUT_SELECTORS = [
    'button[class*="put"]:not([disabled])',           'button[class*="Put"]:not([disabled])',
    'button[class*="sell"]:not([disabled])',          'button[class*="Sell"]:not([disabled])',
    '[class*="deal-btn"][class*="put"]:not([disabled])',
    '[class*="deal-btn"][class*="down"]:not([disabled])',
    '[class*="dealBtn"][class*="put"]:not([disabled])',
    '[class*="button--put"]:not([disabled])',         '[class*="btn--put"]:not([disabled])',
    '[class*="trade__btn"][class*="put"]:not([disabled])',
    '[class*="trade-btn"][class*="put"]:not([disabled])',
    '[data-side="put"]:not([disabled])',              '[data-type="put"]:not([disabled])',
    '[data-direction="put"]:not([disabled])',         '[data-action="put"]:not([disabled])',
    '[data-side="down"]:not([disabled])',             '[data-type="down"]:not([disabled])',
    '[aria-label*="Lower"]:not([disabled])',          '[aria-label*="lower"]:not([disabled])',
    '[aria-label*="بيع"]:not([disabled])',             '[aria-label*="أدنى"]:not([disabled])',
    '[aria-label*="Put"]:not([disabled])',            '[aria-label*="Sell"]:not([disabled])',
    '[class*="put-button"]:not([disabled])',          '[class*="PutButton"]:not([disabled])',
    '[class*="quick-hl-put"]:not([disabled])',        '[class*="QuickHlPut"]:not([disabled])',
    '.btn-put', '[class*="btnPut"]', '#put-btn', '#sell-btn',
    '[class*="sell-btn"]', '[class*="sellBtn"]',      '[class*="tradePut"]',
  ];

  function isAttached(el) {
    return !!(el && el.isConnected !== false && W.document && W.document.contains && W.document.contains(el));
  }
  function isBtnReady(btn) {
    if (!btn) return false;
    try {
      if (btn.disabled) return false;
      if (btn.getAttribute && btn.getAttribute('aria-disabled') === 'true') return false;
      const r = btn.getBoundingClientRect && btn.getBoundingClientRect();
      if (!r) return true; // headless / shim
      if (r.width < 8 || r.height < 8) return false;
    } catch (_) { return true; }
    return true;
  }

  function getReactFiber(el) {
    if (!el) return null;
    for (const k of Object.keys(el)) {
      if (k.indexOf('__reactFiber') === 0 || k.indexOf('__reactInternalInstance') === 0) {
        return el[k];
      }
    }
    return null;
  }

  function fiberDirection(fiber) {
    let f = fiber;
    for (let i = 0; i < 5 && f; i++) {
      const props = f.memoizedProps || f.pendingProps || {};
      const dir = props['data-direction'] || props['data-type'] || props.direction || props.type;
      if (typeof dir === 'string') {
        const d = dir.toLowerCase();
        if (d === 'call' || d === 'buy' || d === 'up')   return 'call';
        if (d === 'put'  || d === 'sell' || d === 'down') return 'put';
      }
      if (typeof props.onClick === 'function') {
        const src = props.onClick.toString().slice(0, 200).toLowerCase();
        if (src.includes('call') || src.includes('buy'))  return 'call';
        if (src.includes('put')  || src.includes('sell')) return 'put';
      }
      f = f.return;
    }
    return null;
  }

  function tryOneCSS(sel) {
    try { return W.document.querySelector(sel); } catch (_) { return null; }
  }

  // Phase 1 — CSS fast path.
  function phase1(direction) {
    const list = direction > 0 ? CALL_SELECTORS : PUT_SELECTORS;
    for (let i = 0; i < list.length; i++) {
      const el = tryOneCSS(list[i]);
      if (isBtnReady(el) && isAttached(el)) {
        metric('dom.resolutions_phase.1').inc();
        return el;
      }
    }
    return null;
  }

  // Phase 2 — fiber walk + text/aria match, prefer largest visible candidate.
  function phase2(direction) {
    let nodes;
    try { nodes = W.document.querySelectorAll('button,[role="button"],[class*="btn"],[class*="Btn"]'); }
    catch (_) { return null; }
    const candidates = [];
    for (let i = 0; i < nodes.length; i++) {
      const btn = nodes[i];
      if (!isBtnReady(btn) || !isAttached(btn)) continue;
      const fiber = getReactFiber(btn);
      if (fiber) {
        const fd = fiberDirection(fiber);
        if (fd === 'call' && direction > 0)  { metric('dom.fiber_hits').inc(); return btn; }
        if (fd === 'put'  && direction < 0)  { metric('dom.fiber_hits').inc(); return btn; }
      }
      const txt = ((btn.textContent || btn.innerText || '') + '').trim();
      const tl = txt.toLowerCase();
      const aria = ((btn.getAttribute && btn.getAttribute('aria-label')) || '').toLowerCase();
      const c = tl + ' ' + aria;
      if (direction > 0 && (txt.includes('شراء') || txt.includes('أعلى') || c.includes('buy') || c.includes('call') || txt.includes('↑') || c.includes('higher') || c.includes('up'))) {
        candidates.push(btn);
      }
      if (direction < 0 && (txt.includes('بيع') || txt.includes('أدنى') || c.includes('sell') || c.includes('put') || txt.includes('↓') || c.includes('lower') || c.includes('down'))) {
        candidates.push(btn);
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      try {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return (rb.width * rb.height) - (ra.width * ra.height);
      } catch (_) { return 0; }
    });
    metric('dom.text_hits').inc();
    metric('dom.resolutions_phase.2').inc();
    return candidates[0];
  }

  // Phase 3 — diagnostic dump of visible buttons.
  function phase3Diagnostic() {
    try {
      const nodes = W.document.querySelectorAll('button,[role="button"]');
      const out = [];
      for (let i = 0; i < nodes.length && out.length < 8; i++) {
        const b = nodes[i];
        let r;
        try { r = b.getBoundingClientRect(); } catch (_) { continue; }
        if (!r || r.width < 20 || r.height < 20) continue;
        const txt = ((b.textContent || '') + '').trim().slice(0, 15);
        const cls = ((b.className || '') + '').slice(0, 25);
        out.push('"' + txt + '" [' + cls + ']');
      }
      QR.bus.emit('dom.diagnostic', { buttons: out });
      return out;
    } catch (_) { return []; }
  }

  function resolveTradeButton(direction) {
    metric('dom.resolutions_total').inc();
    const now = performance.now();
    const cached = direction > 0 ? cachedButtons.call : cachedButtons.put;
    if (cached && isBtnReady(cached) && isAttached(cached) && (now - cachedButtons.at) < PHASE2_CACHE_MS) {
      return cached;
    }
    let btn = phase1(direction);
    if (!btn) btn = phase2(direction);
    if (btn) {
      if (direction > 0) cachedButtons.call = btn;
      else               cachedButtons.put  = btn;
      cachedButtons.at = now;
      return btn;
    }
    metric('dom.resolutions_failed').inc();
    phase3Diagnostic();
    QR.bus.emit('dom.unresolved', { name: direction > 0 ? 'btn.higher' : 'btn.lower' });
    return null;
  }

  // Generic registry retained for non-trade selectors.
  function register(name, chain) {
    if (!Array.isArray(chain) || chain.length === 0) return;
    registry.set(name, { chain, cached: null, lastBoundAt: 0 });
  }
  function tryOneGeneric(spec) {
    if (typeof spec === 'string') return tryOneCSS(spec);
    if (spec && typeof spec === 'object') {
      if (spec.id)  { try { return W.document.getElementById(spec.id); } catch (_) {} }
      if (spec.css) return tryOneCSS(spec.css);
      if (spec.text) {
        try {
          const sel = spec.scope || '[class],[data-side],button,[role="button"]';
          const nodes = W.document.querySelectorAll(sel);
          for (let i = 0; i < nodes.length; i++) {
            const t = ((nodes[i].textContent || '') + '').trim();
            if (spec.exact ? t === spec.text : t.indexOf(spec.text) >= 0) return nodes[i];
          }
        } catch (_) {}
      }
    }
    return null;
  }
  function resolveGeneric(name) {
    const rec = registry.get(name);
    if (!rec) return null;
    if (rec.cached && isAttached(rec.cached)) return rec.cached;
    for (let i = 0; i < rec.chain.length; i++) {
      const el = tryOneGeneric(rec.chain[i]);
      if (el) { rec.cached = el; rec.lastBoundAt = performance.now(); return el; }
    }
    return null;
  }

  function resolve(name) {
    if (name === 'btn.higher') return resolveTradeButton(+1);
    if (name === 'btn.lower')  return resolveTradeButton(-1);
    return resolveGeneric(name);
  }

  function invalidate(name) {
    metric('dom.rebinds').inc();
    if (name === 'btn.higher') { cachedButtons.call = null; return; }
    if (name === 'btn.lower')  { cachedButtons.put  = null; return; }
    if (name) {
      const r = registry.get(name);
      if (r) r.cached = null;
    } else {
      cachedButtons.call = cachedButtons.put = null;
      registry.forEach((r) => { r.cached = null; });
    }
  }

  function startObserver() {
    if (observer || typeof W.MutationObserver !== 'function' || !W.document || !W.document.body) {
      QR.scheduler.defer(startObserver, 250, 'dom.observer.retry');
      return;
    }
    observer = new W.MutationObserver(() => {
      mutationsBudget++;
      if (mutationsBudget === 1) {
        QR.scheduler.defer(() => {
          metric('dom.mutations_observed').inc(mutationsBudget);
          mutationsBudget = 0;
          invalidate();
        }, 400, 'dom.observer.flush');
      }
    });
    try { observer.observe(W.document.body, { childList: true, subtree: true, attributes: false }); }
    catch (_) {}
  }

  function init() {
    startObserver();
  }

  QR.dom = QR.dom || {};
  QR.dom.selfHealing = { register, resolve, invalidate };
  if (QR.kernel) QR.kernel.register('dom.selfHealing', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
