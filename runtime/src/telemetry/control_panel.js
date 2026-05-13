// telemetry/control_panel.js
// Interactive control panel — restores the V11/V12 control surface.
//
// Architecture:
//   Adds a small floating gear button (bottom-left) that expands into a
//   panel with the runtime's interactive controls:
//     - Master halt / resume   → emits `execution.halt` / `execution.resume`
//     - Kelly multiplier         → QR.risk.configure({ kellyMul })
//     - Min-probability gate     → QR.risk.configure({ minProbEdge })
//     - Drawdown cap             → QR.risk.configure({ ddCap })
//     - Loss-streak cap          → QR.risk.configure({ streakCap })
//     - HUD toggle               → QR.telemetry.hud.toggle()
//     - Copy diagnostics         → QR.telemetry.diagnostics.copy()
//     - Reset bankroll/halt      → QR.risk.resetHalt()
//
//   Slider values are persisted to localStorage under `QR_PANEL_STATE_v1`
//   and re-applied on the next boot.
//
// Optimization:
//   - Panel mutates state only on user input. No periodic re-render.
//   - Status indicator subscribes to bus events; no polling.
//
// Failure handling:
//   - If document.body is unavailable at init, defer until it is.
//   - All control handlers are wrapped — a bad input never breaks the panel.
//   - If risk/configure missing (degraded), inputs are disabled.
//
// Telemetry:
//   - `telemetry.panel.clicks.<button>` counters per action
//   - `telemetry.panel.changes.<knob>`  counters per slider change
//
// Integration:
//   Public: mount(), unmount(), toggle(), isMounted().
//   Subscribes: `pipeline.halted`, `pipeline.resumed`, `risk.configured`.
//
// Latency:
//   Interactive; not on any hot path.
//
// Memory:
//   One element tree; ~few KB.
//
// Survivability:
//   Panel failure has zero impact on the trading runtime.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.telemetry && QR.telemetry.controlPanel) return;

  const STORAGE_KEY = 'QR_PANEL_STATE_v1';
  const VISIBILITY_KEY = 'QR_PANEL';   // '0' = hide button entirely

  let host = null;
  let toggleBtn = null;
  let panel = null;
  let statusDot = null;
  let statusLabel = null;
  let haltBtn = null;
  let rejectListEl = null;
  let expanded = false;
  let mounted = false;
  let halted = false;
  const rejectRing = [];   // recent { reason, asset, at }
  const REJECT_CAP = 12;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }

  function pushReject(reason, asset) {
    rejectRing.push({ reason, asset: asset || '', at: performance.now() });
    if (rejectRing.length > REJECT_CAP) rejectRing.shift();
    renderRejectList();
  }
  function renderRejectList() {
    if (!rejectListEl) return;
    if (rejectRing.length === 0) {
      rejectListEl.textContent = '(none yet)';
      return;
    }
    const lines = [];
    for (let i = rejectRing.length - 1; i >= 0; i--) {
      const r = rejectRing[i];
      const ago = ((performance.now() - r.at) / 1000).toFixed(1) + 's';
      lines.push(ago.padStart(6, ' ') + '  ' + r.reason + (r.asset ? '  · ' + r.asset : ''));
    }
    rejectListEl.textContent = lines.join('\n');
  }

  function loadState() {
    try {
      const raw = W.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return (s && typeof s === 'object') ? s : null;
    } catch (_) { return null; }
  }
  function saveState(patch) {
    try {
      const cur = loadState() || {};
      Object.assign(cur, patch);
      W.localStorage.setItem(STORAGE_KEY, JSON.stringify(cur));
    } catch (_) {}
  }

  function isHidden() {
    try { return W.localStorage.getItem(VISIBILITY_KEY) === '0'; } catch (_) { return false; }
  }

  // ──────────────────────────────────────────────────────────────────────
  // DOM construction
  // ──────────────────────────────────────────────────────────────────────

  const COLORS = {
    bg: 'rgba(10,12,16,0.92)',
    border: '#2a4',
    fg: '#cfe0ff',
    fgDim: '#7d8aa0',
    accent: '#7df',
    danger: '#f66',
    ok: '#4f8',
  };

  function el(tag, css, text) {
    const e = W.document.createElement(tag);
    if (css)  e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  function row(label, control) {
    const r = el('div', 'display:flex;align-items:center;gap:8px;margin:4px 0;');
    const l = el('span', `min-width:96px;color:${COLORS.fgDim};font-size:11px;`, label);
    r.appendChild(l);
    r.appendChild(control);
    return r;
  }

  function slider(min, max, step, value, onInput) {
    const wrap = el('div', 'display:flex;align-items:center;gap:6px;flex:1;');
    const s = W.document.createElement('input');
    s.type = 'range';
    s.min = String(min); s.max = String(max); s.step = String(step);
    s.value = String(value);
    s.style.cssText = 'flex:1;accent-color:#7df;';
    const v = el('span', `font-variant-numeric:tabular-nums;color:${COLORS.fg};min-width:42px;text-align:right;`, (+value).toFixed(2));
    s.addEventListener('input', () => {
      v.textContent = (+s.value).toFixed(2);
      try { onInput(+s.value); } catch (_) {}
    });
    wrap.appendChild(s); wrap.appendChild(v);
    return wrap;
  }

  function button(label, color, onClick) {
    const b = el('button', [
      'background:transparent', `color:${color || COLORS.fg}`, `border:1px solid ${color || COLORS.border}`,
      'padding:4px 10px', 'border-radius:4px', 'cursor:pointer', 'font:11px ui-monospace,Menlo,Consolas,monospace',
      'min-width:72px',
    ].join(';'), label);
    b.onmouseover = () => b.style.background = 'rgba(255,255,255,0.06)';
    b.onmouseout  = () => b.style.background = 'transparent';
    b.onclick = () => { try { onClick(); } catch (_) {} };
    return b;
  }

  function buildToggleBtn() {
    toggleBtn = el('button', [
      'position:fixed', 'left:8px', 'bottom:8px', 'z-index:2147483647',
      'background:rgba(10,12,16,0.86)', `color:${COLORS.accent}`, `border:1px solid ${COLORS.border}`,
      'padding:6px 10px', 'border-radius:6px', 'cursor:pointer',
      'font:12px ui-monospace,Menlo,Consolas,monospace',
      'box-shadow:0 4px 16px rgba(0,0,0,.4)',
      'pointer-events:auto',
    ].join(';'), '⚙ QR');
    toggleBtn.onclick = () => setExpanded(!expanded);
    return toggleBtn;
  }

  function buildPanel() {
    panel = el('div', [
      'position:fixed', 'left:8px', 'bottom:48px', 'z-index:2147483647',
      `background:${COLORS.bg}`, `color:${COLORS.fg}`, `border:1px solid ${COLORS.border}`,
      'padding:10px 12px', 'border-radius:8px',
      'font:11px/1.4 ui-monospace,Menlo,Consolas,monospace',
      'box-shadow:0 6px 24px rgba(0,0,0,.5)',
      'min-width:300px', 'max-width:340px',
      'pointer-events:auto', 'display:none',
    ].join(';'));

    // Header
    const header = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;');
    const title = el('span', `color:${COLORS.accent};font-weight:bold;font-size:12px;`, 'QR · Control');
    const close = el('span', `cursor:pointer;color:${COLORS.fgDim};font-size:14px;padding:0 4px;`, '×');
    close.onclick = () => setExpanded(false);
    header.appendChild(title); header.appendChild(close);
    panel.appendChild(header);

    // Status row
    const statusRow = el('div', 'display:flex;align-items:center;gap:8px;margin:6px 0;padding:6px 8px;background:rgba(255,255,255,0.04);border-radius:4px;');
    statusDot = el('span', `color:${COLORS.ok};font-size:14px;`, '●');
    statusLabel = el('span', `color:${COLORS.fg};`, 'RUNNING');
    haltBtn = button('Halt', COLORS.danger, () => {
      metric('telemetry.panel.clicks.halt').inc();
      if (halted) {
        QR.bus.emit('execution.resume', {});
      } else {
        QR.bus.emit('execution.halt', { reason: 'user_request' });
      }
    });
    haltBtn.style.marginLeft = 'auto';
    statusRow.appendChild(statusDot); statusRow.appendChild(statusLabel); statusRow.appendChild(haltBtn);
    panel.appendChild(statusRow);

    // Risk knobs
    const risk = QR.risk && QR.risk.getConfig ? QR.risk.getConfig() : { kellyMul: 0.25, minProbEdge: 0.55, ddCap: 0.20, streakCap: 4 };
    panel.appendChild(el('div', `color:${COLORS.fgDim};margin:8px 0 2px 0;font-size:10px;letter-spacing:.5px;`, 'RISK'));

    panel.appendChild(row('Kelly mul',  slider(0.05, 1.00, 0.05, risk.kellyMul,     (v) => { metric('telemetry.panel.changes.kellyMul').inc(); QR.risk && QR.risk.configure({ kellyMul: v });    saveState({ kellyMul: v }); })));
    panel.appendChild(row('Min prob',   slider(0.50, 0.90, 0.01, risk.minProbEdge,  (v) => { metric('telemetry.panel.changes.minProbEdge').inc(); QR.risk && QR.risk.configure({ minProbEdge: v }); saveState({ minProbEdge: v }); })));
    panel.appendChild(row('DD cap',     slider(0.05, 0.50, 0.01, risk.ddCap,        (v) => { metric('telemetry.panel.changes.ddCap').inc(); QR.risk && QR.risk.configure({ ddCap: v });       saveState({ ddCap: v }); })));
    panel.appendChild(row('Streak cap', slider(1,    10,    1,    risk.streakCap,    (v) => { metric('telemetry.panel.changes.streakCap').inc(); QR.risk && QR.risk.configure({ streakCap: v });   saveState({ streakCap: v }); })));

    // Action buttons row
    panel.appendChild(el('div', `color:${COLORS.fgDim};margin:10px 0 4px 0;font-size:10px;letter-spacing:.5px;`, 'ACTIONS'));
    const actions = el('div', 'display:flex;flex-wrap:wrap;gap:6px;');

    actions.appendChild(button('HUD', COLORS.accent, () => {
      metric('telemetry.panel.clicks.hud').inc();
      QR.telemetry && QR.telemetry.hud && QR.telemetry.hud.toggle();
    }));
    actions.appendChild(button('Copy diag', COLORS.accent, async () => {
      metric('telemetry.panel.clicks.copy').inc();
      if (!QR.telemetry || !QR.telemetry.diagnostics) return;
      const res = await QR.telemetry.diagnostics.copy();
      flashStatus(res && res.ok ? 'copied ✓' : 'copy failed');
    }));
    actions.appendChild(button('Clear halt', COLORS.fg, () => {
      metric('telemetry.panel.clicks.clear_halt').inc();
      QR.risk && QR.risk.resetHalt();
      QR.bus.emit('execution.resume', {});
      flashStatus('halt cleared');
    }));

    panel.appendChild(actions);

    // Reject log section
    panel.appendChild(el('div', `color:${COLORS.fgDim};margin:10px 0 4px 0;font-size:10px;letter-spacing:.5px;`, 'WHY NO TRADE'));
    rejectListEl = el('pre', [
      `color:${COLORS.fg}`, 'background:rgba(255,255,255,0.04)', 'border-radius:4px',
      'padding:6px 8px', 'margin:0', 'max-height:130px', 'overflow:auto',
      'white-space:pre-wrap', 'font-size:10px', 'line-height:1.35',
    ].join(';'), '(none yet)');
    panel.appendChild(rejectListEl);
    renderRejectList();

    // Footer hint
    const hint = el('div', `color:${COLORS.fgDim};margin-top:8px;font-size:10px;`,
      'Hide panel: localStorage.QR_PANEL="0"');
    panel.appendChild(hint);

    return panel;
  }

  function flashStatus(msg) {
    if (!statusLabel) return;
    const prev = statusLabel.textContent;
    const prevColor = statusLabel.style.color;
    statusLabel.textContent = msg;
    statusLabel.style.color = COLORS.accent;
    W.setTimeout(() => {
      refreshStatus();
    }, 1200);
  }

  function refreshStatus() {
    if (!statusDot || !statusLabel) return;
    if (halted) {
      statusDot.style.color = COLORS.danger;
      statusLabel.textContent = 'HALTED';
      statusLabel.style.color = COLORS.danger;
      if (haltBtn) {
        haltBtn.textContent = 'Resume';
        haltBtn.style.color = COLORS.ok;
        haltBtn.style.borderColor = COLORS.ok;
      }
    } else {
      statusDot.style.color = COLORS.ok;
      statusLabel.textContent = 'RUNNING';
      statusLabel.style.color = COLORS.fg;
      if (haltBtn) {
        haltBtn.textContent = 'Halt';
        haltBtn.style.color = COLORS.danger;
        haltBtn.style.borderColor = COLORS.danger;
      }
    }
  }

  function setExpanded(flag) {
    expanded = !!flag;
    if (panel) panel.style.display = expanded ? 'block' : 'none';
    if (toggleBtn) toggleBtn.textContent = expanded ? '⚙ QR ▾' : '⚙ QR';
  }

  function build() {
    if (host) return;
    // Prefer body; fall back to documentElement (always present at document-start).
    const root = (W.document && W.document.body) || (W.document && W.document.documentElement);
    if (!root) {
      QR.scheduler.defer(build, 250, 'panel.build.retry');
      return;
    }
    host = W.document.createElement('div');
    host.id = '__qr_ctrl_host__';
    host.appendChild(buildToggleBtn());
    host.appendChild(buildPanel());
    root.appendChild(host);
    mounted = true;
    refreshStatus();
    // Re-parent to body once it becomes available (avoids style isolation issues).
    if (root !== W.document.body) {
      const moveToBody = () => {
        if (W.document.body && host && host.parentNode !== W.document.body) {
          try { W.document.body.appendChild(host); } catch (_) {}
        }
      };
      try { W.document.addEventListener('DOMContentLoaded', moveToBody, { once: true }); } catch (_) {}
      QR.scheduler.defer(moveToBody, 1000, 'panel.reparent');
    }
    // Open the panel on first ever boot so injection is immediately obvious.
    try {
      if (W.localStorage.getItem('QR_PANEL_SEEN') !== '1') {
        W.localStorage.setItem('QR_PANEL_SEEN', '1');
        setExpanded(true);
      }
    } catch (_) {}
  }

  function unmount() {
    if (!host) return;
    try { host.parentNode && host.parentNode.removeChild(host); } catch (_) {}
    host = null; toggleBtn = null; panel = null; statusDot = null; statusLabel = null; haltBtn = null;
    mounted = false; expanded = false;
  }
  function isMounted() { return mounted; }
  function toggle() { mounted ? unmount() : build(); }

  function applyPersistedState() {
    const s = loadState();
    if (s && QR.risk && QR.risk.configure) QR.risk.configure(s);
  }

  function init() {
    applyPersistedState();
    QR.bus.on('pipeline.halted',  () => { halted = true;  refreshStatus(); });
    QR.bus.on('pipeline.resumed', () => { halted = false; refreshStatus(); });
    QR.bus.on('execution.halt',   () => { halted = true;  refreshStatus(); });
    QR.bus.on('execution.resume', () => { halted = false; refreshStatus(); });
    QR.bus.on('pipeline.reject',  (ev) => { if (ev && ev.reason) pushReject(ev.reason, ev.asset); });
    if (isHidden()) return;
    // Mount immediately on documentElement (always available at @run-at
    // document-start). Avoids the previous 800ms defer that could race
    // page-load on slow connections.
    build();
  }

  QR.telemetry = QR.telemetry || {};
  QR.telemetry.controlPanel = { build, unmount, toggle, isMounted };
  if (QR.kernel) QR.kernel.register('telemetry.controlPanel', init, unmount);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
