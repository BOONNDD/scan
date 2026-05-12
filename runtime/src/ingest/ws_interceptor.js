// ingest/ws_interceptor.js
// WebSocket prototype hook — capture all sockets and route incoming frames.
//
// Architecture:
//   Patches `WebSocket.prototype.addEventListener` and the `onmessage`
//   accessor so that every socket the page opens is observed. Each frame
//   is handed to the binary_parser; the parser may yield 0..N normalized
//   payloads which are then forwarded as raw events on `ingest.raw`.
//
//   We do NOT replace the WebSocket constructor — that would break the
//   platform's own bookkeeping. We only attach listeners.
//
// Optimization:
//   - Listener is a single function reference; no closure allocation per frame.
//   - ArrayBuffer frames are forwarded by reference; no copy.
//   - String frames are kept as strings; parser decides whether to copy.
//
// Failure handling:
//   - If the prototype is frozen, we record the failure and fall back to
//     watching the constructor. If both fail, the runtime enters degraded
//     mode (no execution, telemetry only).
//   - Frames whose origin URL does not match the allowed prefix are ignored.
//
// Telemetry:
//   - `ingest.ws.sockets_seen`
//   - `ingest.ws.frames_total`
//   - `ingest.ws.frames_bytes`
//   - `ingest.ws.errors`
//
// Integration:
//   Must run at `document-start`. Kernel boots ingest before features so
//   subscribers are wired in time.
//
// Latency:
//   ~hundreds of nanoseconds per frame to dispatch to the parser.
//
// Memory:
//   One small registry of observed sockets; no per-frame allocation.
//
// Survivability:
//   The interceptor never throws into platform code. Any handler exception
//   is swallowed and counted; the platform never sees it.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.ingest && QR.ingest.ws) return;

  const ALLOWED = /(po\.market|pocketoption\.com|chat-po\.site)/i;
  const sockets = new Set();
  let installed = false;
  let degraded = false;

  function metric(name) {
    const m = QR.metrics;
    return m ? m.counter(name) : { inc() {} };
  }

  function emitRaw(socket, data) {
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
      parser.parseFrame(socket, data);
    } catch (e) {
      metric('ingest.ws.errors').inc();
    }
  }

  function attach(socket) {
    if (sockets.has(socket)) return;
    if (socket.url && !ALLOWED.test(socket.url)) return;
    sockets.add(socket);
    metric('ingest.ws.sockets_seen').inc();
    QR.bus.emit('ingest.ws.opened', { url: socket.url });

    const listener = (ev) => emitRaw(socket, ev.data);
    try {
      socket.addEventListener('message', listener, { passive: true });
    } catch (_) {
      // Fallback: chain onmessage
      const prev = socket.onmessage;
      socket.onmessage = function (ev) {
        emitRaw(socket, ev.data);
        if (typeof prev === 'function') {
          try { prev.call(this, ev); } catch (_) {}
        }
      };
    }

    socket.addEventListener('close', () => {
      sockets.delete(socket);
      QR.bus.emit('ingest.ws.closed', { url: socket.url });
    }, { once: true });
  }

  function patchAddEventListener() {
    const proto = W.WebSocket && W.WebSocket.prototype;
    if (!proto || typeof proto.addEventListener !== 'function') return false;
    const orig = proto.addEventListener;
    try {
      proto.addEventListener = function (type, fn, opts) {
        if (type === 'message') attach(this);
        return orig.call(this, type, fn, opts);
      };
    } catch (_) {
      return false;
    }
    // Also patch the `onmessage` setter so we observe any later assignment.
    const desc = Object.getOwnPropertyDescriptor(proto, 'onmessage');
    if (desc && desc.set) {
      try {
        Object.defineProperty(proto, 'onmessage', {
          configurable: true,
          enumerable: desc.enumerable,
          get: desc.get,
          set: function (fn) {
            attach(this);
            return desc.set.call(this, fn);
          },
        });
      } catch (_) {}
    }
    return true;
  }

  function patchConstructor() {
    const OrigWS = W.WebSocket;
    if (!OrigWS) return false;
    try {
      W.WebSocket = function (url, protocols) {
        const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
        attach(ws);
        return ws;
      };
      W.WebSocket.prototype = OrigWS.prototype;
      W.WebSocket.CONNECTING = OrigWS.CONNECTING;
      W.WebSocket.OPEN = OrigWS.OPEN;
      W.WebSocket.CLOSING = OrigWS.CLOSING;
      W.WebSocket.CLOSED = OrigWS.CLOSED;
      return true;
    } catch (_) {
      return false;
    }
  }

  function install() {
    if (installed) return;
    installed = true;
    const ok1 = patchAddEventListener();
    const ok2 = ok1 || patchConstructor();
    if (!ok2) {
      degraded = true;
      QR.bus.emit('ingest.ws.degraded', { reason: 'no WebSocket hook available' });
    }
  }

  function isDegraded() { return degraded; }
  function socketCount() { return sockets.size; }

  QR.ingest = QR.ingest || {};
  QR.ingest.ws = { install, isDegraded, socketCount };

  // Self-register with the kernel.
  if (QR.kernel) QR.kernel.register('ingest.ws', install);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
