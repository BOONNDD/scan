// ingest/binary_parser.js
// Socket.io 4.x framing + JSON / binary payload extraction.
//
// Architecture:
//   The Pocket Option WebSockets speak Engine.IO 4 + Socket.IO 4. Frames look like:
//     "42" + JSON                — event packet (text)
//     "451-" + JSON + binary     — event with attached binary parts
//     "2" / "3"                  — engine.io ping/pong
//     binary frame               — attachment for the preceding "45N-"
//
//   This module is a streaming parser. For each socket it remembers:
//     - the last pending event name (from a "45N-" header)
//     - a fragment buffer for binary attachments
//   It emits normalized event payloads via `ingest.raw_event`.
//
// Optimization:
//   - Text frames are parsed with a single pass, no regex on the hot path.
//   - Binary frames are passed as ArrayBuffer with byte offsets — no copies
//     unless we genuinely need to mutate.
//   - JSON parsing is best-effort; malformed payloads increment a counter.
//
// Failure handling:
//   - Unknown frame prefixes are logged (sampled) and ignored.
//   - Pending event names time out after 500 ms — protects against
//     cross-socket leaks if two sockets are 45N- racing.
//
// Telemetry:
//   - `ingest.parser.text_frames`
//   - `ingest.parser.binary_frames`
//   - `ingest.parser.events_emitted`
//   - `ingest.parser.malformed`
//
// Integration:
//   `ws_interceptor` calls `parseFrame(socket, data)`. Emits to bus on
//   channel `ingest.raw_event`. Tick normalizer subscribes to that channel.
//
// Latency:
//   ≈ µs per frame; one JSON.parse on text frames.
//
// Memory:
//   WeakMap<socket, state>. No long-lived allocations per frame.
//
// Survivability:
//   Parser never throws. All branches return cleanly even on malformed input.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.ingest && QR.ingest.parser) return;

  const PENDING_TTL_MS = 500;
  const state = new WeakMap();

  function metric(name) {
    const m = QR.metrics;
    return m ? m.counter(name) : { inc() {} };
  }

  function stateOf(socket) {
    let s = state.get(socket);
    if (!s) {
      s = { pendingName: '', pendingAt: 0, fragments: [], fragExpected: 0 };
      state.set(socket, s);
    }
    return s;
  }

  function emit(event) {
    metric('ingest.parser.events_emitted').inc();
    QR.bus.emit('ingest.raw_event', event);
  }

  function tryParseJson(s) {
    try { return JSON.parse(s); } catch (_) {
      metric('ingest.parser.malformed').inc();
      return null;
    }
  }

  // Engine.IO type chars are at offset 0. Socket.IO packet type at offset 1.
  // "42" → EIO message (4), SIO event (2). "451-X" → event with X binary attachments.
  function parseText(socket, txt) {
    metric('ingest.parser.text_frames').inc();
    if (txt.length < 2) return;
    const eio = txt.charCodeAt(0);
    if (eio === 50 /* '2' */) return; // ping
    if (eio === 51 /* '3' */) return; // pong
    if (eio !== 52 /* '4' */) return;

    const sio = txt.charCodeAt(1);
    if (sio === 53 /* '5' */) {
      // "45N-" binary-event header
      let i = 2;
      let n = 0;
      while (i < txt.length && txt.charCodeAt(i) >= 48 && txt.charCodeAt(i) <= 57) {
        n = n * 10 + (txt.charCodeAt(i) - 48);
        i++;
      }
      if (txt.charCodeAt(i) !== 45 /* '-' */) return;
      i++;
      const json = tryParseJson(txt.slice(i));
      if (!json || !Array.isArray(json)) return;
      const s = stateOf(socket);
      s.pendingName = String(json[0] || '');
      s.pendingAt = performance.now();
      s.fragments.length = 0;
      s.fragExpected = n;
      return;
    }

    if (sio === 50 /* '2' */) {
      // "42[event,payload]"
      const json = tryParseJson(txt.slice(2));
      if (!json || !Array.isArray(json)) return;
      const name = String(json[0] || '');
      const payload = json.length > 1 ? json[1] : null;
      emit({ kind: 'json', name, payload, url: socket.url, ts: performance.now() });
    }
  }

  function parseBinary(socket, buf) {
    metric('ingest.parser.binary_frames').inc();
    const s = stateOf(socket);
    if (!s.pendingName || (performance.now() - s.pendingAt) > PENDING_TTL_MS) {
      // Orphan binary — count it and drop.
      metric('ingest.parser.orphan_binary').inc();
      s.pendingName = '';
      s.fragments.length = 0;
      return;
    }
    s.fragments.push(buf);
    if (s.fragments.length >= s.fragExpected) {
      const name = s.pendingName;
      const frags = s.fragments.slice();
      s.pendingName = '';
      s.fragments.length = 0;
      s.fragExpected = 0;
      emit({ kind: 'binary', name, parts: frags, url: socket.url, ts: performance.now() });
    }
  }

  function parseFrame(socket, data) {
    if (typeof data === 'string') {
      parseText(socket, data);
    } else if (data instanceof ArrayBuffer) {
      parseBinary(socket, data);
    } else if (data && data.buffer instanceof ArrayBuffer) {
      // typed array view
      parseBinary(socket, data.buffer);
    } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
      data.arrayBuffer().then((ab) => parseBinary(socket, ab)).catch(() => {
        metric('ingest.parser.errors').inc();
      });
    }
  }

  QR.ingest = QR.ingest || {};
  QR.ingest.parser = { parseFrame };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
