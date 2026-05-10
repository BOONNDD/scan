// ==UserScript==
// @name         🔍 PO Platform Analyzer
// @namespace    po-platform-analyzer-v1
// @version      1.0.0
// @description  تحليل عميق لمنصة PocketOption — XHR، Fetch، WebSocket، ملفات JS، DOM، Storage — يحفظ كل شيء في IndexedDB
// @author       aoirusra
// @match        *://pocketoption.com/*
// @match        *://*.pocketoption.com/*
// @match        *://m.pocketoption.com/*
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function(W) {
  'use strict';

  const PA_VER      = '1.0.0';
  const PA_SESSION  = Date.now().toString(36);
  const PA_DB_NAME  = 'po_analyzer_v1';
  const PA_DB_VER   = 1;
  const PA_STORES   = ['requests', 'websockets', 'scripts', 'storage', 'dom', 'events'];
  const MAX_BODY    = 2000;   // max chars saved from request/response bodies
  const MAX_WS_MSG  = 1200;   // max chars saved per WS message
  const MAX_FEED    = 300;    // in-memory ring buffer size per store

  // ══════════════════════════════════════════════════════════════════════
  // § 1  IndexedDB — persistent storage
  // ══════════════════════════════════════════════════════════════════════
  let _paDb = null;

  function _paDbOpen() {
    if (_paDb) return Promise.resolve(_paDb);
    return new Promise((resolve, reject) => {
      const req = W.indexedDB.open(PA_DB_NAME, PA_DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        for (const name of PA_STORES) {
          if (db.objectStoreNames.contains(name)) continue;
          const s = db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
          s.createIndex('ts',      'ts',      { unique: false });
          s.createIndex('session', 'session', { unique: false });
          if (name === 'requests' || name === 'websockets') {
            s.createIndex('url', 'url', { unique: false });
          }
        }
      };
      req.onsuccess = e => { _paDb = e.target.result; resolve(_paDb); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  // Fire-and-forget save
  function _paSave(store, obj) {
    _paDbOpen().then(db => {
      try {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).add({ ...obj, ts: obj.ts || Date.now(), session: PA_SESSION });
      } catch(_) {}
    }).catch(() => {});
  }

  function _paGetAll(store) {
    return _paDbOpen().then(db => new Promise(resolve => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = e => resolve(e.target.result || []);
      req.onerror   = () => resolve([]);
    })).catch(() => []);
  }

  function _paCount(store) {
    return _paDbOpen().then(db => new Promise(resolve => {
      const req = db.transaction(store, 'readonly').objectStore(store).count();
      req.onsuccess = e => resolve(e.target.result || 0);
      req.onerror   = () => resolve(0);
    })).catch(() => 0);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 2  In-memory ring buffer + UI trigger
  // ══════════════════════════════════════════════════════════════════════
  const _feed = {};
  for (const s of PA_STORES) _feed[s] = [];

  let _updateScheduled = false;
  let _uiReady = false;

  function _feedAdd(store, obj) {
    if (!_feed[store]) return;
    _feed[store].unshift(obj);
    if (_feed[store].length > MAX_FEED) _feed[store].pop();
    _paSave(store, obj);
    if (_uiReady && !_updateScheduled) {
      _updateScheduled = true;
      setTimeout(() => { _updateScheduled = false; _renderTab(); }, 250);
    }
    _updateBadge();
  }

  function _updateBadge() {
    const el = W.document.getElementById('paToggle');
    if (!el) return;
    const total = PA_STORES.reduce((s, k) => s + (_feed[k]?.length || 0), 0);
    el.textContent = '🔍 PA ' + total;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 3  XHR interceptor
  // ══════════════════════════════════════════════════════════════════════
  const _origXhrOpen    = W.XMLHttpRequest.prototype.open;
  const _origXhrSend    = W.XMLHttpRequest.prototype.send;
  const _origXhrSetHdr  = W.XMLHttpRequest.prototype.setRequestHeader;

  W.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._pa = { method, url: String(url), headers: {}, start: Date.now() };
    return _origXhrOpen.apply(this, [method, url, ...rest]);
  };

  W.XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (this._pa) this._pa.headers[name] = value;
    return _origXhrSetHdr.apply(this, [name, value]);
  };

  W.XMLHttpRequest.prototype.send = function(body) {
    this.addEventListener('loadend', () => {
      if (!this._pa) return;
      try {
        _feedAdd('requests', {
          type:     'XHR',
          method:   this._pa.method,
          url:      this._pa.url,
          status:   this.status,
          duration: Date.now() - this._pa.start,
          size:     (this.responseText || '').length,
          reqBody:  body ? String(body).slice(0, MAX_BODY) : null,
          resBody:  (this.responseText || '').slice(0, MAX_BODY),
          headers:  this._pa.headers,
        });
      } catch(_) {}
    });
    return _origXhrSend.apply(this, [body]);
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 4  Fetch interceptor
  // ══════════════════════════════════════════════════════════════════════
  const _origFetch = W.fetch.bind(W);
  W.fetch = function(input, init) {
    const url    = typeof input === 'string' ? input : (input?.url || String(input));
    const method = (init?.method || 'GET').toUpperCase();
    const start  = Date.now();
    const pr     = _origFetch(input, init);
    pr.then(async res => {
      try {
        const text = await res.clone().text().catch(() => '');
        _feedAdd('requests', {
          type:     'FETCH',
          method, url,
          status:   res.status,
          duration: Date.now() - start,
          size:     text.length,
          reqBody:  init?.body ? String(init.body).slice(0, MAX_BODY) : null,
          resBody:  text.slice(0, MAX_BODY),
          headers:  Object.fromEntries([...res.headers.entries()]),
        });
      } catch(_) {}
    }).catch(() => {});
    return pr;
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 5  WebSocket interceptor — runs at document-start to catch all WS
  // ══════════════════════════════════════════════════════════════════════
  const _OrigWS = W.WebSocket;

  function _getPort(url) {
    try {
      const u = new URL(url);
      return u.port || (u.protocol === 'wss:' ? '443' : '80');
    } catch(_) { return '?'; }
  }

  W.WebSocket = function(url, protocols) {
    const ws  = new _OrigWS(url, protocols);
    const rec = {
      url:      String(url),
      port:     _getPort(String(url)),
      protocol: Array.isArray(protocols) ? protocols.join(',') : (protocols || ''),
      msgsSent: 0, msgsRecv: 0,
      bytesSent: 0, bytesRecv: 0,
    };

    _feedAdd('websockets', { ...rec, event: 'OPEN' });
    _feedAdd('events', { event: 'WS_OPEN', url: rec.url, port: rec.port });

    const _origWsSend = ws.send.bind(ws);
    ws.send = function(data) {
      const size = typeof data === 'string' ? data.length : (data?.byteLength || 0);
      rec.msgsSent++; rec.bytesSent += size;
      _feedAdd('websockets', {
        url: rec.url, port: rec.port, event: 'SEND', size,
        preview: typeof data === 'string' ? data.slice(0, MAX_WS_MSG) : '[binary ' + size + 'B]',
      });
      return _origWsSend(data);
    };

    ws.addEventListener('message', e => {
      const size = typeof e.data === 'string' ? e.data.length : (e.data?.byteLength || 0);
      rec.msgsRecv++; rec.bytesRecv += size;
      _feedAdd('websockets', {
        url: rec.url, port: rec.port, event: 'RECV', size,
        preview: typeof e.data === 'string' ? e.data.slice(0, MAX_WS_MSG) : '[binary ' + size + 'B]',
      });
    });

    ws.addEventListener('close', e => {
      _feedAdd('websockets', { url: rec.url, port: rec.port, event: 'CLOSE', code: e.code, reason: e.reason });
      _feedAdd('events', { event: 'WS_CLOSE', url: rec.url, code: e.code,
        stats: { sent: rec.msgsSent, recv: rec.msgsRecv, bytesSent: rec.bytesSent, bytesRecv: rec.bytesRecv } });
    });

    ws.addEventListener('error', () => {
      _feedAdd('websockets', { url: rec.url, port: rec.port, event: 'ERROR' });
    });

    return ws;
  };

  // Preserve WebSocket static properties
  W.WebSocket.prototype  = _OrigWS.prototype;
  W.WebSocket.CONNECTING = _OrigWS.CONNECTING;
  W.WebSocket.OPEN       = _OrigWS.OPEN;
  W.WebSocket.CLOSING    = _OrigWS.CLOSING;
  W.WebSocket.CLOSED     = _OrigWS.CLOSED;

  // ══════════════════════════════════════════════════════════════════════
  // § 6  JS file analyzer
  // ══════════════════════════════════════════════════════════════════════
  const _scannedUrls = new Set();

  function _analyzeJs(src) {
    return {
      wsUrls:       [...new Set(src.match(/wss?:\/\/[^\s"'`)\]>]+/g)   || [])].slice(0, 30),
      httpUrls:     [...new Set(src.match(/https?:\/\/[^\s"'`)\]>]+/g)  || [])].slice(0, 60),
      apiPaths:     [...new Set(src.match(/['"`]\/(?:api|v\d|socket\.io|ws|gateway|trade)[^\s"'`)\]>]+/g) || [])].slice(0, 50),
      socketEvents: [...new Set(src.match(/(?:\.emit|\.on)\s*\(\s*['"`]([^'"`]+)['"`]/g)  || [])].slice(0, 80),
      openOrders:   [...new Set(src.match(/openOrder|closeOrder|successopenOrder|failopenOrder/g) || [])],
      versions:     [...new Set(src.match(/['"v]?\d+\.\d+\.\d+['"]/g)   || [])].slice(0, 15),
      tokens:       src.match(/(?:token|secret|key)\s*[:=]\s*['"][a-zA-Z0-9_\-]{10,}['"]/gi)?.slice(0, 5) || [],
      appIds:       src.match(/app[_\-]?id\s*[:=]\s*['"][^'"]+['"]/gi)?.slice(0, 5) || [],
      funcNames:    [...new Set(src.match(/function\s+([a-zA-Z_$][a-zA-Z0-9_$]{2,})/g) || [])].slice(0, 60),
      configKeys:   [...new Set(src.match(/["'](?:asset|action|amount|isDemo|optionType|requestId|time|uid|percentProfit)["']/g) || [])],
      socketioMsgs: [...new Set(src.match(/42\[["'][a-zA-Z]+["']/g) || [])].slice(0, 30),
    };
  }

  async function _scanScript(src, isInline) {
    if (!isInline) {
      if (_scannedUrls.has(src)) return;
      _scannedUrls.add(src);
    }

    let code = '';
    if (isInline) {
      code = src;
    } else {
      try {
        const res = await _origFetch(src, { cache: 'force-cache' });
        code = await res.text();
      } catch(_) { return; }
    }

    if (code.length < 50) return;

    const analysis = _analyzeJs(code);
    const hasInteresting = analysis.wsUrls.length || analysis.apiPaths.length ||
      analysis.socketEvents.length || analysis.openOrders.length;

    _feedAdd('scripts', {
      url:      isInline ? '[inline-' + code.slice(0, 20).replace(/\s+/g, '') + ']' : src,
      size:     code.length,
      isInline: !!isInline,
      interesting: !!hasInteresting,
      analysis,
    });
  }

  function _scanAllScripts() {
    // Inline scripts
    W.document.querySelectorAll('script:not([src])').forEach(s => {
      if ((s.textContent || '').length > 100) _scanScript(s.textContent, true);
    });
    // External scripts from DOM
    W.document.querySelectorAll('script[src]').forEach(s => {
      if (s.src) _scanScript(s.src, false);
    });
    // Resource timing API — catches lazy-loaded scripts
    (W.performance?.getEntriesByType('resource') || []).forEach(e => {
      if ((e.initiatorType === 'script' || e.name.endsWith('.js')) && !_scannedUrls.has(e.name)) {
        _scanScript(e.name, false);
      }
    });
  }

  // Watch for dynamically added scripts
  function _startScriptObserver() {
    const obs = new MutationObserver(muts => {
      for (const mut of muts) {
        for (const node of mut.addedNodes) {
          if (node.nodeName === 'SCRIPT') {
            if (node.src) _scanScript(node.src, false);
            else if ((node.textContent || '').length > 100) _scanScript(node.textContent, true);
          }
        }
      }
    });
    obs.observe(W.document.documentElement, { subtree: true, childList: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 7  Storage reader
  // ══════════════════════════════════════════════════════════════════════
  function _readStorage() {
    const readStore = (store, type) => {
      try {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          const val = store.getItem(key);
          _feedAdd('storage', { type, key, value: (val || '').slice(0, 500), size: (val || '').length });
        }
      } catch(_) {}
    };

    readStore(W.localStorage,   'localStorage');
    readStore(W.sessionStorage, 'sessionStorage');

    // Cookies
    (W.document.cookie || '').split(';').forEach(c => {
      const idx = c.indexOf('=');
      if (idx < 0) return;
      const key = c.slice(0, idx).trim();
      const val = c.slice(idx + 1).trim();
      if (key) _feedAdd('storage', { type: 'cookie', key, value: val.slice(0, 500) });
    });

    // IndexedDB databases list
    if (W.indexedDB.databases) {
      W.indexedDB.databases().then(dbs => {
        dbs.forEach(db => _feedAdd('storage', { type: 'indexedDB', key: db.name, value: 'version:' + db.version }));
      }).catch(() => {});
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 8  DOM analyzer
  // ══════════════════════════════════════════════════════════════════════
  function _analyzeDom() {
    // All buttons + roles
    W.document.querySelectorAll('button,[role="button"]').forEach(el => {
      if (!el.offsetParent && !el.id) return; // skip hidden non-ID buttons
      const attrs = {};
      for (const a of el.attributes) attrs[a.name] = a.value;
      _feedAdd('dom', {
        type: 'button', tag: el.tagName, id: el.id || null,
        className: (el.className || '').slice(0, 120),
        text: (el.textContent || '').trim().slice(0, 60),
        attrs,
      });
    });

    // All data-* elements
    W.document.querySelectorAll('*').forEach(el => {
      const dataAttrs = {};
      for (const a of el.attributes) if (a.name.startsWith('data-')) dataAttrs[a.name] = a.value;
      if (Object.keys(dataAttrs).length >= 2) {
        _feedAdd('dom', { type: 'data-el', tag: el.tagName, id: el.id || null, attrs: dataAttrs });
      }
    });

    // Forms + inputs
    W.document.querySelectorAll('form,input,select').forEach(el => {
      _feedAdd('dom', {
        type: 'form-el', tag: el.tagName, id: el.id || null,
        name: el.name || null, inputType: el.type || null,
        className: (el.className || '').slice(0, 80),
      });
    });

    // Scripts and external resources
    W.document.querySelectorAll('script[src],link[href],img[src]').forEach(el => {
      _feedAdd('dom', {
        type: el.tagName.toLowerCase(),
        src:  (el.src || el.href || '').split('?')[0],
        rel:  el.rel || null,
        integrity: el.integrity || null,
      });
    });

    // Meta tags
    W.document.querySelectorAll('meta[name],meta[property]').forEach(m => {
      _feedAdd('dom', { type: 'meta', name: m.name || m.property, content: (m.content || '').slice(0, 300) });
    });

    // React root / Vue app detection
    const reactRoot = W.document.querySelector('#root,#app,[data-reactroot],[id*="react"]');
    if (reactRoot) {
      const fiberKey = Object.keys(reactRoot).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      _feedAdd('events', { event: 'FRAMEWORK_DETECTED', framework: 'React', fiberKey: fiberKey || null });
    }
    const vueRoot = W.document.querySelector('[data-v-app],[data-vue]');
    if (vueRoot) _feedAdd('events', { event: 'FRAMEWORK_DETECTED', framework: 'Vue' });
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 9  Performance API — resource timing
  // ══════════════════════════════════════════════════════════════════════
  function _scanPerformance() {
    const entries = W.performance?.getEntriesByType('resource') || [];
    const byType = {};
    entries.forEach(e => {
      const type = e.initiatorType || 'other';
      if (!byType[type]) byType[type] = [];
      byType[type].push({ name: e.name, size: e.encodedBodySize, duration: Math.round(e.duration) });
    });
    _feedAdd('events', {
      event: 'PERF_RESOURCES',
      total: entries.length,
      byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])),
      scripts: (byType.script || []).map(e => e.name),
      xhrs:    (byType.xmlhttprequest || []).map(e => e.name),
      fetches: (byType.fetch || []).map(e => e.name),
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 10  UI
  // ══════════════════════════════════════════════════════════════════════
  const TABS = [
    { id: 'websockets', label: '🔌 WebSocket' },
    { id: 'requests',   label: '🌐 Network'   },
    { id: 'scripts',    label: '📜 Scripts'   },
    { id: 'storage',    label: '💾 Storage'   },
    { id: 'dom',        label: '🏗 DOM'       },
    { id: 'events',     label: '📡 Events'    },
  ];

  let _activeTab = 'websockets';

  const PA_CSS = `
  #paRoot{position:fixed;top:12px;right:12px;z-index:2147483646;font-family:monospace;direction:ltr;}
  #paToggle{background:#050810;border:1.5px solid rgba(0,180,255,0.35);color:rgba(0,200,255,0.85);padding:5px 11px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:0.3px;box-shadow:0 4px 16px rgba(0,0,0,0.6);}
  #paToggle:hover{background:rgba(0,180,255,0.08);}
  #paPanel{position:fixed;top:44px;right:12px;width:480px;max-height:86vh;background:#060810;border:1px solid rgba(0,180,255,0.12);border-radius:14px;display:none;flex-direction:column;box-shadow:0 32px 100px rgba(0,0,0,0.95);overflow:hidden;}
  #paPanel.open{display:flex;}
  #paHdr{display:flex;align-items:center;gap:6px;padding:9px 13px;border-bottom:1px solid rgba(255,255,255,0.05);flex-shrink:0;background:rgba(0,180,255,0.03);}
  #paHdr .pa-title{font-size:11px;font-weight:700;color:rgba(0,200,255,0.85);flex:1;}
  .pa-hbtn{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.4);padding:3px 9px;border-radius:5px;cursor:pointer;font-size:10px;transition:all 0.15s;}
  .pa-hbtn:hover{background:rgba(0,180,255,0.1);color:rgba(0,200,255,0.8);border-color:rgba(0,180,255,0.3);}
  .pa-hbtn.danger:hover{background:rgba(255,55,85,0.1);color:rgba(255,80,100,0.8);border-color:rgba(255,55,85,0.3);}
  #paTabs{display:flex;gap:3px;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.04);flex-shrink:0;overflow-x:auto;}
  #paTabs::-webkit-scrollbar{height:0;}
  .pa-tab{padding:3px 9px;border-radius:5px;font-size:10px;cursor:pointer;color:rgba(255,255,255,0.28);border:1px solid transparent;white-space:nowrap;transition:all 0.15s;}
  .pa-tab.active{background:rgba(0,180,255,0.1);border-color:rgba(0,180,255,0.25);color:rgba(0,210,255,0.9);}
  .pa-tab:hover:not(.active){color:rgba(255,255,255,0.5);}
  #paStats{padding:3px 13px 4px;font-size:9px;color:rgba(255,255,255,0.18);flex-shrink:0;border-bottom:1px solid rgba(255,255,255,0.03);}
  #paFilter{padding:4px 10px;flex-shrink:0;}
  #paFilter input{width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:5px;color:rgba(255,255,255,0.6);font-size:10px;padding:3px 7px;outline:none;box-sizing:border-box;font-family:monospace;}
  #paFilter input::placeholder{color:rgba(255,255,255,0.2);}
  #paBody{flex:1;overflow-y:auto;padding:6px;}
  #paBody::-webkit-scrollbar{width:3px;}
  #paBody::-webkit-scrollbar-thumb{background:rgba(0,180,255,0.18);}
  .pa-entry{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:6px;padding:5px 8px;margin-bottom:4px;font-size:10px;word-break:break-all;transition:border-color 0.15s;}
  .pa-entry:hover{border-color:rgba(0,180,255,0.15);background:rgba(0,180,255,0.02);}
  .pa-entry.highlight{border-color:rgba(0,255,150,0.2);background:rgba(0,255,150,0.02);}
  .pa-row1{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}
  .pa-url{color:rgba(100,200,255,0.8);font-size:9.5px;display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .pa-badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:8px;font-weight:700;letter-spacing:0.3px;}
  .badge-ws  {background:rgba(140,0,255,0.15);color:rgba(190,100,255,0.9);}
  .badge-xhr {background:rgba(255,140,0,0.1); color:rgba(255,180,0,0.9);}
  .badge-fetch{background:rgba(0,180,100,0.1);color:rgba(0,220,110,0.9);}
  .badge-send{background:rgba(255,100,0,0.12);color:rgba(255,140,0,0.9);}
  .badge-recv{background:rgba(0,150,255,0.12);color:rgba(0,190,255,0.9);}
  .badge-open{background:rgba(0,255,150,0.1); color:rgba(0,255,150,0.85);}
  .badge-close{background:rgba(255,55,85,0.1);color:rgba(255,80,100,0.8);}
  .badge-info{background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.45);}
  .pa-status-ok {color:rgba(0,220,110,0.8);font-size:9px;}
  .pa-status-err{color:rgba(255,80,100,0.8);font-size:9px;}
  .pa-meta{color:rgba(255,255,255,0.25);font-size:9px;}
  .pa-preview{color:rgba(255,255,255,0.45);font-size:9px;margin-top:3px;max-height:80px;overflow:hidden;background:rgba(0,0,0,0.35);padding:3px 6px;border-radius:4px;white-space:pre-wrap;}
  .pa-section{color:rgba(0,180,255,0.55);font-size:9px;font-weight:700;margin:5px 0 2px;border-bottom:1px solid rgba(0,180,255,0.08);padding-bottom:2px;letter-spacing:0.3px;}
  .pa-empty{color:rgba(255,255,255,0.15);font-size:11px;padding:30px;text-align:center;}
  #paFooter{padding:5px 12px;border-top:1px solid rgba(255,255,255,0.04);font-size:9px;color:rgba(255,255,255,0.18);flex-shrink:0;}
  `;

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _fmtSize(n) {
    if (!n) return '';
    if (n < 1024) return n + 'B';
    return (n / 1024).toFixed(1) + 'KB';
  }

  function _fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.getHours().toString().padStart(2,'0') + ':' +
           d.getMinutes().toString().padStart(2,'0') + ':' +
           d.getSeconds().toString().padStart(2,'0');
  }

  function _renderTab() {
    const body   = W.document.getElementById('paBody');
    const statsEl= W.document.getElementById('paStats');
    const filter = (W.document.getElementById('paFilterInput')?.value || '').toLowerCase();
    if (!body) return;

    // Async stats update
    Promise.all(PA_STORES.map(s => _paCount(s))).then(counts => {
      if (statsEl) statsEl.textContent = 'DB: ' +
        PA_STORES.map((s, i) => s + ':' + counts[i]).join(' | ');
    });

    let items = _feed[_activeTab] || [];
    if (filter) items = items.filter(it => JSON.stringify(it).toLowerCase().includes(filter));

    if (items.length === 0) {
      body.innerHTML = '<div class="pa-empty">لا توجد بيانات بعد — ابدأ التصفح أو اضغط 🔄 مسح</div>';
      return;
    }

    let html = '';
    for (const item of items.slice(0, 150)) {
      if (_activeTab === 'requests') {
        const cls   = item.type === 'XHR' ? 'badge-xhr' : 'badge-fetch';
        const stCls = (item.status >= 400 || !item.status) ? 'pa-status-err' : 'pa-status-ok';
        html += `<div class="pa-entry">
          <div class="pa-row1">
            <span class="pa-badge ${cls}">${_esc(item.type)}</span>
            <span class="pa-badge badge-info">${_esc(item.method)}</span>
            <span class="${stCls}">${item.status || '?'}</span>
            <span class="pa-meta">${item.duration}ms ${_fmtSize(item.size)}</span>
            <span class="pa-meta">${_fmtTime(item.ts)}</span>
          </div>
          <span class="pa-url">${_esc(item.url)}</span>
          ${item.resBody ? `<div class="pa-preview">${_esc(item.resBody.slice(0, 250))}</div>` : ''}
        </div>`;

      } else if (_activeTab === 'websockets') {
        const evMap = { OPEN:'badge-open', CLOSE:'badge-close', SEND:'badge-send', RECV:'badge-recv', ERROR:'badge-close' };
        const badgeCls = evMap[item.event] || 'badge-ws';
        html += `<div class="pa-entry${item.event==='OPEN'?' highlight':''}">
          <div class="pa-row1">
            <span class="pa-badge ${badgeCls}">${_esc(item.event)}</span>
            ${item.port ? `<span class="pa-meta">:${item.port}</span>` : ''}
            ${item.size ? `<span class="pa-meta">${_fmtSize(item.size)}</span>` : ''}
            <span class="pa-meta">${_fmtTime(item.ts)}</span>
          </div>
          <span class="pa-url">${_esc(item.url || '')}</span>
          ${item.preview ? `<div class="pa-preview">${_esc(item.preview.slice(0, 400))}</div>` : ''}
          ${item.code != null ? `<div class="pa-meta">code:${item.code} ${_esc(item.reason||'')}</div>` : ''}
          ${item.stats ? `<div class="pa-meta">sent:${item.stats.sent} recv:${item.stats.recv} ↑${_fmtSize(item.stats.bytesSent)} ↓${_fmtSize(item.stats.bytesRecv)}</div>` : ''}
        </div>`;

      } else if (_activeTab === 'scripts') {
        const a = item.analysis || {};
        const interesting = item.interesting;
        html += `<div class="pa-entry${interesting?' highlight':''}">
          <div class="pa-row1">
            <span class="pa-badge badge-info">${item.isInline ? 'INLINE' : 'SCRIPT'}</span>
            ${interesting ? '<span class="pa-badge badge-open">★ مهم</span>' : ''}
            <span class="pa-meta">${_fmtSize(item.size)}</span>
          </div>
          <span class="pa-url">${_esc(item.url)}</span>
          ${a.wsUrls?.length     ? `<div class="pa-section">🔌 WS URLs (${a.wsUrls.length})</div><div class="pa-preview">${a.wsUrls.map(_esc).join('\n')}</div>` : ''}
          ${a.apiPaths?.length   ? `<div class="pa-section">🌐 API Paths (${a.apiPaths.length})</div><div class="pa-preview">${a.apiPaths.slice(0,25).map(_esc).join('\n')}</div>` : ''}
          ${a.socketEvents?.length ? `<div class="pa-section">📡 Socket Events (${a.socketEvents.length})</div><div class="pa-preview">${a.socketEvents.slice(0,25).map(_esc).join('\n')}</div>` : ''}
          ${a.openOrders?.length ? `<div class="pa-section">💰 Order Events</div><div class="pa-preview">${[...new Set(a.openOrders)].map(_esc).join(', ')}</div>` : ''}
          ${a.versions?.length   ? `<div class="pa-section">🔢 Versions</div><div class="pa-preview">${a.versions.slice(0,10).map(_esc).join(' | ')}</div>` : ''}
          ${a.tokens?.length     ? `<div class="pa-section">🔑 Tokens/Keys</div><div class="pa-preview">${a.tokens.map(_esc).join('\n')}</div>` : ''}
        </div>`;

      } else if (_activeTab === 'storage') {
        const tMap = { localStorage:'badge-fetch', sessionStorage:'badge-xhr', cookie:'badge-send', indexedDB:'badge-ws' };
        html += `<div class="pa-entry">
          <div class="pa-row1">
            <span class="pa-badge ${tMap[item.type]||'badge-info'}">${_esc(item.type)}</span>
            <span style="color:rgba(255,200,80,0.85);font-size:10px;">${_esc(item.key)}</span>
            ${item.size ? `<span class="pa-meta">${_fmtSize(item.size)}</span>` : ''}
          </div>
          ${item.value ? `<div class="pa-preview">${_esc(item.value.slice(0, 300))}</div>` : ''}
        </div>`;

      } else if (_activeTab === 'dom') {
        const tMap = { button:'badge-send', 'data-el':'badge-recv', 'form-el':'badge-xhr', script:'badge-info', link:'badge-info', img:'badge-info', meta:'badge-ws' };
        html += `<div class="pa-entry">
          <div class="pa-row1">
            <span class="pa-badge ${tMap[item.type]||'badge-info'}">${_esc(item.type)}</span>
            <span style="color:rgba(255,255,255,0.6);font-size:10px;">${_esc(item.tag||'')}${item.id?'#'+item.id:''}</span>
          </div>
          ${item.text   ? `<div class="pa-meta">"${_esc(item.text)}"</div>` : ''}
          ${item.src    ? `<span class="pa-url">${_esc((item.src||'').slice(0,120))}</span>` : ''}
          ${item.className ? `<div class="pa-meta">.${_esc(item.className.slice(0,80))}</div>` : ''}
          ${item.attrs && Object.keys(item.attrs).length
            ? `<div class="pa-preview">${Object.entries(item.attrs).map(([k,v])=>_esc(k)+'="'+_esc(v)+'"').join('\n')}</div>` : ''}
        </div>`;

      } else if (_activeTab === 'events') {
        html += `<div class="pa-entry">
          <div class="pa-row1">
            <span class="pa-badge badge-ws">${_esc(item.event)}</span>
            <span class="pa-meta">${_fmtTime(item.ts)}</span>
          </div>
          <div class="pa-preview">${_esc(JSON.stringify(item, null, 2).slice(0, 400))}</div>
        </div>`;
      }
    }

    body.innerHTML = html || '<div class="pa-empty">لا توجد نتائج</div>';
  }

  async function _exportAll() {
    const data = { _meta: { version: PA_VER, session: PA_SESSION, url: W.location.href, exportedAt: new Date().toISOString() } };
    for (const store of PA_STORES) data[store] = await _paGetAll(store);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = W.document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'po_analyzer_' + PA_SESSION + '.json';
    a.click();
    _feedAdd('events', { event: 'EXPORT', session: PA_SESSION, stores: Object.fromEntries(PA_STORES.map(s => [s, data[s]?.length || 0])) });
  }

  function _clearAll() {
    if (!W.confirm('مسح كل البيانات من الذاكرة؟')) return;
    for (const s of PA_STORES) _feed[s] = [];
    _renderTab();
  }

  function _initUI() {
    const root = W.document.createElement('div');
    root.id = 'paRoot';

    const tabsHtml = TABS.map(t =>
      `<div class="pa-tab${t.id === _activeTab ? ' active' : ''}" data-tab="${t.id}">${t.label}</div>`
    ).join('');

    root.innerHTML = `
      <style>${PA_CSS}</style>
      <button id="paToggle">🔍 PA 0</button>
      <div id="paPanel">
        <div id="paHdr">
          <span class="pa-title">🔍 PO Platform Analyzer v${PA_VER}</span>
          <button class="pa-hbtn" id="paScanBtn">🔄 مسح</button>
          <button class="pa-hbtn" id="paExportBtn">📦 تصدير</button>
          <button class="pa-hbtn danger" id="paClearBtn">🗑</button>
          <button class="pa-hbtn" id="paCloseBtn">✕</button>
        </div>
        <div id="paTabs">${tabsHtml}</div>
        <div id="paStats">جاري التحميل…</div>
        <div id="paFilter"><input id="paFilterInput" placeholder="🔍 بحث في النتائج…"></div>
        <div id="paBody"></div>
        <div id="paFooter">session: ${PA_SESSION} | ${W.location.hostname}</div>
      </div>
    `;

    W.document.body.appendChild(root);
    _uiReady = true;

    // Toggle panel
    const toggle = W.document.getElementById('paToggle');
    const panel  = W.document.getElementById('paPanel');
    toggle.addEventListener('click', () => { panel.classList.toggle('open'); if (panel.classList.contains('open')) _renderTab(); });
    W.document.getElementById('paCloseBtn').addEventListener('click', () => panel.classList.remove('open'));

    // Action buttons
    W.document.getElementById('paScanBtn').addEventListener('click', () => {
      _scanAllScripts(); _readStorage(); _analyzeDom(); _scanPerformance();
      W.document.getElementById('paScanBtn').textContent = '✅ تم';
      setTimeout(() => { W.document.getElementById('paScanBtn').textContent = '🔄 مسح'; }, 2000);
    });
    W.document.getElementById('paExportBtn').addEventListener('click', _exportAll);
    W.document.getElementById('paClearBtn').addEventListener('click', _clearAll);

    // Filter
    W.document.getElementById('paFilterInput').addEventListener('input', _renderTab);

    // Tabs
    W.document.querySelectorAll('.pa-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        _activeTab = tab.dataset.tab;
        W.document.querySelectorAll('.pa-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === _activeTab));
        _renderTab();
      });
    });

    _renderTab();
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 11  Boot
  // ══════════════════════════════════════════════════════════════════════
  function _boot() {
    if (!W.document.body) { setTimeout(_boot, 100); return; }

    _initUI();

    // Log page load event
    _feedAdd('events', {
      event: 'PAGE_LOAD',
      url:   W.location.href,
      title: W.document.title,
      ua:    W.navigator.userAgent,
      lang:  W.navigator.language,
      platform: W.navigator.platform,
    });

    // Initial scans (delayed to let page settle)
    setTimeout(() => {
      _readStorage();
      _scanAllScripts();
      _analyzeDom();
      _scanPerformance();
    }, 1500);

    // Re-scan storage every 60s (site may update localStorage)
    setInterval(_readStorage, 60000);

    // Start watching for new scripts
    _startScriptObserver();
  }

  if (W.document.readyState === 'loading') {
    W.document.addEventListener('DOMContentLoaded', _boot);
  } else {
    setTimeout(_boot, 0);
  }

})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
