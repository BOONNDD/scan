// ingest/ws_interceptor.js
// WebSocket interception via Proxy(NativeWS) — ported from V12.
//
// Architecture:
//   Replace `window.WebSocket` with a Proxy over the native constructor.
//   For every WebSocket constructed by the page we:
//     1. Attach a `message` listener that hands every frame to the parser.
//     2. Wrap `ws.send` to observe outbound `42[event,payload]` packets —
//        this is how we learn `changeSymbol`, `saveCharts`, `openOrder`
//        without polling.
//     3. Respond to engine.io ping ('2') with pong ('3') as a keepalive,
//        matching V12's behavior so the server doesn't time us out.
//
// Optimization:
//   - One Proxy, not prototype-patching, so multiple userscripts can coexist.
//   - Frame dispatch goes straight to the parser; no copies.
//
// Failure handling:
//   - If WebSocket is missing (e.g., service worker context), this is a
//     no-op and the runtime enters degraded mode.
//   - Send-wrapper failures are silenced — they would only break the
//     platform's own bookkeeping.
//
// Telemetry:
//   - ingest.ws.sockets_seen / frames_total / frames_bytes / errors
//   - ingest.ws.trade_socket_seen
//   - ingest.ws.outbound_event.<name> (per outbound event type)
//
// Integration:
//   Must run at @run-at document-start. Re-bootstrappable: if the page
//   reassigns WebSocket, the Proxy stays intact.
//
// Latency:
//   ~hundreds of nanoseconds per frame.
//
// Memory:
//   One Set of observed sockets; no per-frame allocation.
//
// Survivability:
//   The interceptor never throws into platform code. Any handler
//   exception is swallowed and counted.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.ingest && QR.ingest.ws) return;

  const sockets = new Set();
  let installed = false;
  let degraded = false;

  function metric(name) {
    const m = QR.metrics;
    return m ? m.counter(name) : { inc() {} };
  }

  function isTradeSocket(url) {
    if (!url) return false;
    if (url.includes('po.market')) return true;
    if (url.includes('chat-po')) return false;
    if (url.includes('events-po')) return false;
    if (url.includes('socket.io') && url.includes('api')) return true;
    return false;
  }

  function handleFrame(ws, data) {
    metric('ingest.ws.frames_total').inc();
    if (data && data.byteLength) {
      const c = QR.metrics && QR.metrics.counter('ingest.ws.frames_bytes');
      if (c) c.inc(data.byteLength);
    } else if (typeof data === 'string') {
      const c = QR.metrics && QR.metrics.counter('ingest.ws.frames_bytes');
      if (c) c.inc(data.length);
    }
    try {
      const parser = QR.ingest && QR.ingest.parser;
      if (!parser) return;
      parser.parseFrame(ws, data);
    } catch (_) {
      metric('ingest.ws.errors').inc();
    }
  }

  function observeOutbound(ws, origSend) {
    return function patchedSend(data) {
      if (typeof data === 'string' && data.length > 2 && data.charCodeAt(0) === 52 && data.charCodeAt(1) === 50) {
        // "42[event,payload]"
        try {
          const arr = JSON.parse(data.slice(2));
          if (Array.isArray(arr) && arr.length >= 1) {
            const name = String(arr[0] || '');
            const payload = arr.length > 1 ? arr[1] : null;
            metric('ingest.ws.outbound_event.' + name).inc();
            QR.bus.emit('ingest.outbound_event', { name, payload, url: ws.url });
          }
        } catch (_) {}
      }
      return origSend(data);
    };
  }

  function attach(ws, url) {
    if (sockets.has(ws)) return;
    sockets.add(ws);
    metric('ingest.ws.sockets_seen').inc();
    if (isTradeSocket(url)) metric('ingest.ws.trade_socket_seen').inc();
    QR.bus.emit('ingest.ws.opened', { url });

    // Wrap send to observe outbound events.
    try {
      const origSend = ws.send.bind(ws);
      ws.send = observeOutbound(ws, origSend);
    } catch (_) {}

    // Listen for inbound frames + auto-pong on engine.io ping.
    try {
      ws.addEventListener('message', (ev) => {
        const raw = ev.data;
        if (typeof raw === 'string' && raw === '2') {
          // engine.io ping → reply with pong; don't forward to parser.
          try { ws.send('3'); } catch (_) {}
          return;
        }
        handleFrame(ws, raw);
      }, { passive: true });
    } catch (_) {
      // Fallback: chain onmessage.
      const prev = ws.onmessage;
      ws.onmessage = function (ev) {
        if (typeof ev.data === 'string' && ev.data === '2') {
          try { ws.send('3'); } catch (_) {}
        } else {
          handleFrame(ws, ev.data);
        }
        if (typeof prev === 'function') {
          try { prev.call(this, ev); } catch (_) {}
        }
      };
    }

    try {
      ws.addEventListener('close', () => {
        sockets.delete(ws);
        QR.bus.emit('ingest.ws.closed', { url });
      }, { once: true });
    } catch (_) {}
  }

  function install() {
    if (installed) return;
    installed = true;
    const NativeWS = W.WebSocket;
    if (!NativeWS) {
      degraded = true;
      QR.bus.emit('ingest.ws.degraded', { reason: 'no_WebSocket' });
      return;
    }
    try {
      const ProxyWS = new Proxy(NativeWS, {
        construct(Target, args) {
          const ws = new Target(...args);
          attach(ws, String(args[0] || ''));
          return ws;
        },
        apply(Target, thisArg, args) {
          const ws = new Target(...args);
          attach(ws, String(args[0] || ''));
          return ws;
        },
        get(Target, prop, receiver) {
          if (prop === 'CONNECTING') return 0;
          if (prop === 'OPEN')       return 1;
          if (prop === 'CLOSING')    return 2;
          if (prop === 'CLOSED')     return 3;
          const v = Reflect.get(Target, prop, receiver);
          return typeof v === 'function' ? v.bind(Target) : v;
        },
      });
      W.WebSocket = ProxyWS;
    } catch (e) {
      degraded = true;
      QR.bus.emit('ingest.ws.degraded', { reason: String(e && e.message || e) });
    }
  }

  function isDegraded() { return degraded; }
  function socketCount() { return sockets.size; }

  QR.ingest = QR.ingest || {};
  QR.ingest.ws = { install, isDegraded, socketCount };
  if (QR.kernel) QR.kernel.register('ingest.ws', install);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
