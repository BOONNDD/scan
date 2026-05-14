// ==UserScript==
// @name         🍪 PO Cookie Extractor — Full Session Dump
// @namespace    po-cookie-extractor-v1
// @version      1.0.0
// @description  Extracts all cookies, localStorage, sessionStorage, and WebSocket auth from PocketOption
// @author       aoirusra
// @match        *://pocketoption.com/*
// @match        *://*.pocketoption.com/*
// @match        *://m.pocketoption.com/*
// @match        *://trade.pocketoption.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  'use strict';
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // ── Wait for DOM ──────────────────────────────────────────────────────────
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // ── Parse document.cookie string ─────────────────────────────────────────
  function getAllCookies() {
    const raw = document.cookie;
    if (!raw) return [];
    return raw.split(';').map(c => {
      const idx = c.indexOf('=');
      if (idx === -1) return { name: c.trim(), value: '' };
      return {
        name:  c.slice(0, idx).trim(),
        value: c.slice(idx + 1).trim()
      };
    }).filter(c => c.name);
  }

  // ── Extract localStorage ──────────────────────────────────────────────────
  function getLocalStorage() {
    const result = [];
    try {
      for (let i = 0; i < W.localStorage.length; i++) {
        const k = W.localStorage.key(i);
        result.push({ key: k, value: W.localStorage.getItem(k) });
      }
    } catch (_) {}
    return result;
  }

  // ── Extract sessionStorage ────────────────────────────────────────────────
  function getSessionStorage() {
    const result = [];
    try {
      for (let i = 0; i < W.sessionStorage.length; i++) {
        const k = W.sessionStorage.key(i);
        result.push({ key: k, value: W.sessionStorage.getItem(k) });
      }
    } catch (_) {}
    return result;
  }

  // ── Try reading AppData (PO global state) ─────────────────────────────────
  function getAppData() {
    const result = {};
    try {
      const ad = W.AppData || W.__app_data || W.app_data;
      if (ad && typeof ad === 'object') {
        const fields = ['user_id','email','name','balance','demo_balance',
                        'currency','is_demo','userSecret','isIslamicAccount',
                        'platform','country','uid'];
        fields.forEach(f => { if (ad[f] !== undefined) result[f] = ad[f]; });
      }
    } catch (_) {}
    return result;
  }

  // ── Build cURL command for WebSocket handshake ────────────────────────────
  function buildCurlCommand(cookies) {
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    return `# ──── DEMO (حساب تجريبي) ────
websocat -v \\
  --header "Cookie: ${cookieStr}" \\
  --header "Origin: https://m.pocketoption.com" \\
  --header "User-Agent: Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36" \\
  "wss://demo-api-eu.po.market/socket.io/?EIO=4&transport=websocket"

# ──── REAL (حساب حقيقي) ────
websocat -v \\
  --header "Cookie: ${cookieStr}" \\
  --header "Origin: https://m.pocketoption.com" \\
  --header "User-Agent: Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36" \\
  "wss://api-spb.po.market/socket.io/?EIO=4&transport=websocket"

# ──── بعد الاتصال أرسل هذه بالترتيب ────
# 1) اتصال Socket.IO:
40
# 2) صفقة شراء DEMO (عدّل asset و time حسب الحاجة):
42["openOrder",{"asset":"EURUSD_otc","amount":1,"action":"call","isDemo":1,"requestId":${Date.now()},"optionType":100,"time":60}]`;
  }

  // ── CSS ───────────────────────────────────────────────────────────────────
  const CSS = `
    #poCookieRoot {
      position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
      font-family: 'SF Mono', ui-monospace, monospace; direction: ltr;
    }
    #poCookieIcon {
      width: 46px; height: 46px; border-radius: 14px;
      background: #1E3A2F; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; box-shadow: 0 4px 18px rgba(30,58,47,0.35);
      transition: all 0.2s ease;
    }
    #poCookieIcon:hover { transform: scale(1.07); }
    #poCookiePanel {
      position: fixed; bottom: 76px; right: 8px;
      width: 520px; max-width: calc(100vw - 16px);
      max-height: calc(100svh - 110px);
      background: #F8F5F0; border: 1px solid #E5DDD5;
      border-radius: 20px; box-shadow: 0 8px 40px rgba(0,0,0,0.13);
      display: none; flex-direction: column; overflow: hidden;
    }
    #poCookiePanel.open { display: flex; }
    #pcHeader {
      background: #fff; border-bottom: 1px solid #EDE8E2;
      padding: 12px 16px; border-radius: 20px 20px 0 0;
      display: flex; align-items: center; gap: 10px; flex-shrink: 0;
    }
    #pcTitle { font-size: 12px; font-weight: 800; color: #1E3A2F; flex: 1; letter-spacing: 0.3px; }
    .pc-hbtn {
      padding: 5px 12px; border-radius: 20px; border: 1px solid #E5DDD5;
      background: #fff; color: #6B7280; font-size: 9px; font-weight: 700;
      cursor: pointer; font-family: inherit; transition: all 0.15s;
    }
    .pc-hbtn:hover { background: #F0FDF4; border-color: #86EFAC; color: #16A34A; }
    .pc-hbtn.danger:hover { background: #FEF2F2; border-color: #FCA5A5; color: #DC2626; }
    #pcTabs {
      display: flex; gap: 4px; padding: 8px 12px;
      background: #fff; border-bottom: 1px solid #EDE8E2; flex-shrink: 0;
    }
    .pc-tab {
      padding: 4px 14px; border-radius: 20px; border: 1px solid #E5DDD5;
      background: transparent; color: #9CA3AF; font-size: 9px; font-weight: 700;
      cursor: pointer; font-family: inherit; transition: all 0.15s;
    }
    .pc-tab.active { background: #1E3A2F; border-color: #1E3A2F; color: #fff; }
    #pcBody { overflow-y: auto; flex: 1; padding: 10px; }
    #pcBody::-webkit-scrollbar { width: 3px; }
    #pcBody::-webkit-scrollbar-thumb { background: #D1C8BE; border-radius: 3px; }
    .pc-section { margin-bottom: 12px; }
    .pc-section-hdr {
      font-size: 9px; font-weight: 700; color: #6B7280; text-transform: uppercase;
      letter-spacing: 1px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;
    }
    .pc-section-hdr::after { content:''; flex:1; height:1px; background:#EDE8E2; }
    .pc-count {
      background: #F0FDF4; border: 1px solid #86EFAC; color: #16A34A;
      border-radius: 10px; padding: 1px 7px; font-size: 8px; font-weight: 800;
    }
    .pc-row {
      display: flex; gap: 6px; align-items: flex-start; padding: 5px 8px;
      background: #fff; border: 1px solid #EDE8E2; border-radius: 8px;
      margin-bottom: 4px; cursor: pointer; transition: background 0.1s;
      border-right: 3px solid #1E3A2F;
    }
    .pc-row:hover { background: #F0FDF4; }
    .pc-row.important { border-right-color: #DC2626; }
    .pc-key {
      font-size: 9px; font-weight: 700; color: #1E3A2F; min-width: 120px;
      flex-shrink: 0; word-break: break-all;
    }
    .pc-row.important .pc-key { color: #DC2626; }
    .pc-val {
      font-size: 8.5px; color: #374151; word-break: break-all;
      overflow: hidden; max-height: 60px; flex: 1;
    }
    .pc-val.truncated { -webkit-line-clamp: 3; display: -webkit-box; -webkit-box-orient: vertical; }
    .pc-copy-hint { font-size: 7px; color: #9CA3AF; flex-shrink: 0; align-self: center; }
    .pc-curl {
      background: #1A1A1A; color: #86EFAC; font-size: 8.5px; padding: 12px;
      border-radius: 10px; white-space: pre-wrap; word-break: break-all;
      line-height: 1.6; border: 1px solid #2D5540; margin-bottom: 8px;
    }
    .pc-copy-all-btn {
      width: 100%; padding: 10px; border-radius: 12px; border: none;
      background: #1E3A2F; color: #fff; font-family: inherit;
      font-size: 11px; font-weight: 800; cursor: pointer;
      transition: all 0.15s; letter-spacing: 0.3px;
    }
    .pc-copy-all-btn:hover { background: #2D5540; }
    .pc-copy-all-btn.copied { background: #16A34A; }
    #pcStatus {
      padding: 6px 14px 8px; font-size: 7.5px; color: #9CA3AF;
      border-top: 1px solid #EDE8E2; background: #fff;
      border-radius: 0 0 20px 20px; text-align: center; flex-shrink: 0;
    }
    .pc-empty { font-size: 9px; color: #9CA3AF; text-align: center; padding: 16px; }
    @media(max-width:480px){
      #poCookiePanel { width: calc(100vw - 16px); right: 8px; }
    }
  `;

  // ── Important cookie names to highlight ───────────────────────────────────
  const IMPORTANT_KEYS = [
    'po_auth','auth','ssid','_session','user_id','uid','token',
    'remember_me','PHPSESSID','laravel_session','po_user',
    'access_token','refresh_token','jwt','bearer','sid'
  ];

  function isImportant(name) {
    const n = name.toLowerCase();
    return IMPORTANT_KEYS.some(k => n.includes(k));
  }

  // ── Copy to clipboard ─────────────────────────────────────────────────────
  function copyText(text, btn) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✓ تم النسخ';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
      }
    } catch (_) {}
  }

  // ── Build cookie row HTML ─────────────────────────────────────────────────
  function buildRows(items, keyProp, valProp) {
    if (!items.length) return '<div class="pc-empty">لا بيانات</div>';
    return items.map(item => {
      const k = item[keyProp] || '';
      const v = item[valProp] || '';
      const imp = isImportant(k);
      return `<div class="pc-row${imp ? ' important' : ''}" data-val="${encodeURIComponent(v)}" data-key="${encodeURIComponent(k)}" title="انقر للنسخ">
        <span class="pc-key">${escHtml(k)}</span>
        <span class="pc-val truncated">${escHtml(v.length > 120 ? v.slice(0,120)+'…' : v)}</span>
        <span class="pc-copy-hint">⎘</span>
      </div>`;
    }).join('');
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Render tab content ────────────────────────────────────────────────────
  function renderTab(tab, cookies, ls, ss, appData) {
    const body = document.getElementById('pcBody');
    if (!body) return;

    if (tab === 'cookies') {
      const imp = cookies.filter(c => isImportant(c.name));
      const rest = cookies.filter(c => !isImportant(c.name));
      body.innerHTML = `
        <div class="pc-section">
          <div class="pc-section-hdr">
            🔑 مهم — Auth & Session
            <span class="pc-count">${imp.length}</span>
          </div>
          ${buildRows(imp, 'name', 'value')}
        </div>
        <div class="pc-section">
          <div class="pc-section-hdr">
            🍪 كل الكوكيز
            <span class="pc-count">${rest.length}</span>
          </div>
          ${buildRows(rest, 'name', 'value')}
        </div>`;
    } else if (tab === 'storage') {
      body.innerHTML = `
        <div class="pc-section">
          <div class="pc-section-hdr">💾 localStorage <span class="pc-count">${ls.length}</span></div>
          ${buildRows(ls, 'key', 'value')}
        </div>
        <div class="pc-section">
          <div class="pc-section-hdr">🗂 sessionStorage <span class="pc-count">${ss.length}</span></div>
          ${buildRows(ss, 'key', 'value')}
        </div>`;
    } else if (tab === 'appdata') {
      const entries = Object.entries(appData);
      body.innerHTML = `
        <div class="pc-section">
          <div class="pc-section-hdr">⚙️ AppData (بيانات الحساب) <span class="pc-count">${entries.length}</span></div>
          ${entries.length ? entries.map(([k,v]) => `
            <div class="pc-row important" data-val="${encodeURIComponent(String(v))}" data-key="${encodeURIComponent(k)}" title="انقر للنسخ">
              <span class="pc-key">${escHtml(k)}</span>
              <span class="pc-val">${escHtml(String(v))}</span>
              <span class="pc-copy-hint">⎘</span>
            </div>`).join('') : '<div class="pc-empty">لم يُعثر على AppData — تأكد من تسجيل الدخول</div>'}
        </div>`;
    } else if (tab === 'curl') {
      const curlCmd = buildCurlCommand(cookies);
      // Full cookie string for copy
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      body.innerHTML = `
        <div class="pc-section">
          <div class="pc-section-hdr">🔗 Cookie String</div>
          <div class="pc-curl" id="pcCookieStr">${escHtml(cookieStr)}</div>
          <button class="pc-copy-all-btn" id="pcCopyCookieStr">⎘ نسخ Cookie String</button>
        </div>
        <div class="pc-section" style="margin-top:10px;">
          <div class="pc-section-hdr">⚡ websocat Command</div>
          <div class="pc-curl">${escHtml(curlCmd)}</div>
          <button class="pc-copy-all-btn" id="pcCopyCurl">⎘ نسخ الأمر كاملاً</button>
        </div>`;

      document.getElementById('pcCopyCookieStr')?.addEventListener('click', function() {
        copyText(cookieStr, this);
      });
      document.getElementById('pcCopyCurl')?.addEventListener('click', function() {
        copyText(curlCmd, this);
      });
    }

    // Row click → copy value
    body.querySelectorAll('.pc-row').forEach(row => {
      row.addEventListener('click', () => {
        const v = decodeURIComponent(row.dataset.val || '');
        const k = decodeURIComponent(row.dataset.key || '');
        copyText(v);
        row.style.background = '#F0FDF4';
        setTimeout(() => { row.style.background = ''; }, 800);
        updateStatus(`✓ تم نسخ: ${k}`);
      });
    });
  }

  function updateStatus(msg) {
    const el = document.getElementById('pcStatus');
    if (el) { el.textContent = msg; setTimeout(() => { el.textContent = ''; }, 2500); }
  }

  // ── Build full panel ──────────────────────────────────────────────────────
  function buildPanel() {
    // Remove if already exists
    const existing = document.getElementById('poCookieRoot');
    if (existing) existing.remove();

    const root = document.createElement('div');
    root.id = 'poCookieRoot';

    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const cookies   = getAllCookies();
    const ls        = getLocalStorage();
    const ss        = getSessionStorage();
    const appData   = getAppData();
    let activeTab   = 'cookies';

    root.innerHTML += `
      <button id="poCookieIcon" title="PO Cookie Extractor">🍪</button>
      <div id="poCookiePanel">
        <div id="pcHeader">
          <span id="pcTitle">🍪 PO Cookie Extractor v1.0</span>
          <button class="pc-hbtn" id="pcRefresh">↻ تحديث</button>
          <button class="pc-hbtn" id="pcCopyAll">⎘ نسخ الكل</button>
          <button class="pc-hbtn danger" id="pcClose">✕</button>
        </div>
        <div id="pcTabs">
          <button class="pc-tab active" data-tab="cookies">🍪 Cookies (${cookies.length})</button>
          <button class="pc-tab" data-tab="storage">💾 Storage (${ls.length + ss.length})</button>
          <button class="pc-tab" data-tab="appdata">⚙️ AppData</button>
          <button class="pc-tab" data-tab="curl">⚡ cURL/WS</button>
        </div>
        <div id="pcBody"></div>
        <div id="pcStatus"></div>
      </div>`;

    document.body.appendChild(root);

    const icon  = document.getElementById('poCookieIcon');
    const panel = document.getElementById('poCookiePanel');

    icon.addEventListener('click', () => panel.classList.toggle('open'));
    document.getElementById('pcClose').addEventListener('click', () => panel.classList.remove('open'));

    // Tabs
    document.querySelectorAll('.pc-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.pc-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeTab = tab.dataset.tab;
        renderTab(activeTab, getAllCookies(), getLocalStorage(), getSessionStorage(), getAppData());
      });
    });

    // Refresh
    document.getElementById('pcRefresh').addEventListener('click', () => {
      renderTab(activeTab, getAllCookies(), getLocalStorage(), getSessionStorage(), getAppData());
      updateStatus('✓ تم التحديث');
    });

    // Copy All (cookies as curl-ready string)
    document.getElementById('pcCopyAll').addEventListener('click', function() {
      const c = getAllCookies();
      const str = c.map(x => `${x.name}=${x.value}`).join('; ');
      copyText(str, this);
    });

    // Initial render
    renderTab(activeTab, cookies, ls, ss, appData);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  ready(buildPanel);

})();
