// ingest/binary_parser.js
// MsgPack decoder + fragment buffering + Q1 binary signature fast-path.
// Ported verbatim from V12_SUPREME_HYBRID (commit 543507d) — the parser is
// battle-tested against live Pocket Option WebSocket frames.
//
// Architecture:
//   Two entry points:
//     parseText(socket, txt)   — "42[event,payload]" or "45N-[event]" framing.
//     parseBinary(socket, buf) — binary payload that follows a "45N-" header.
//   For each socket we keep:
//     - pendingName / pendingAt — per-socket event-name slot with 500ms TTL.
//     - fragments               — fragment buffer for split msgpack payloads.
//   Decoded events are emitted on `ingest.raw_event` with `{ name, payload }`.
//
// Optimization:
//   - Hand-written msgpack reader (no allocations besides decoded objects).
//   - Q1 fast-path: detects "[["-prefixed tick arrays via byte signature and
//     bypasses msgpack entirely for the hottest packets.
//   - Fragment buffer merges via Uint8Array.set, then retries msgpack decode.
//
// Failure handling:
//   - Decode failures push the buffer into the fragment slot, expecting the
//     next frame to complete the message.
//   - 500ms TTL on pending event names protects against cross-socket leaks.
//   - 5s TTL on fragment buffers protects against permanent buffer growth.
//
// Telemetry:
//   - ingest.parser.text_frames / binary_frames / events_emitted / malformed
//   - ingest.parser.q1_fast_path / fragment_merge
//
// Integration:
//   Called from ingest/ws_interceptor.js.
//
// Latency:
//   Q1 fast-path: ~µs. MsgPack decode: scales with payload size.
//
// Memory:
//   WeakMap<socket, state>. Fragment buffers bounded by TTL.
//
// Survivability:
//   Every decode path is guarded; malformed frames never throw.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.ingest && QR.ingest.parser) return;

  const PENDING_TTL_MS = 500;
  const FRAG_TTL_MS    = 5000;

  // Per-socket parser state.
  const state = new WeakMap();

  // Q1 signature: leading "[[" indicates a JSON tick array embedded in a binary frame.
  const Q1_SIG = new Uint8Array([0x5b, 0x5b, 0x22]);

  function metric(name) {
    const m = QR.metrics;
    return m ? m.counter(name) : { inc() {} };
  }

  function stateOf(socket) {
    let s = state.get(socket);
    if (!s) {
      s = { pendingName: '', pendingAt: 0, fragBuf: null, fragAt: 0 };
      state.set(socket, s);
    }
    return s;
  }

  function emit(event) {
    metric('ingest.parser.events_emitted').inc();
    QR.bus.emit('ingest.raw_event', event);
  }

  // ──────────────────────────────────────────────────────────────────────
  // MsgPack decoder (ported from V12 verbatim, with minor formatting).
  // ──────────────────────────────────────────────────────────────────────
  function msgpackDecode(buffer) {
    const buf  = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
    const off  = buffer.byteOffset || 0;
    const view = new DataView(buf);
    const bytes= new Uint8Array(buf, off);
    let pos = 0;
    const rb   = () => bytes[pos++];
    const ru8  = () => bytes[pos++];
    const ru16 = () => { const v = view.getUint16(pos, false); pos += 2; return v; };
    const ru32 = () => { const v = view.getUint32(pos, false); pos += 4; return v; };
    const ri8  = () => { const v = view.getInt8(pos);          pos += 1; return v; };
    const ri16 = () => { const v = view.getInt16(pos, false);  pos += 2; return v; };
    const ri32 = () => { const v = view.getInt32(pos, false);  pos += 4; return v; };
    const rf32 = () => { const v = view.getFloat32(pos, false);pos += 4; return v; };
    const rf64 = () => { const v = view.getFloat64(pos, false);pos += 8; return v; };
    const ri64 = () => { const h = view.getInt32(pos, false), l = view.getUint32(pos+4, false); pos += 8; return h*4294967296+l; };
    const ru64 = () => { const h = view.getUint32(pos, false), l = view.getUint32(pos+4, false); pos += 8; return h*4294967296+l; };
    const rStr = (n) => { const s = new TextDecoder().decode(bytes.subarray(pos, pos+n)); pos += n; return s; };
    const rBin = (n) => { const b = bytes.subarray(pos, pos+n); pos += n; return b; };
    function decode() {
      const b = rb();
      if (b <= 0x7f) return b;
      if ((b & 0xf0) === 0x80) { const n = b & 0xf; const o = {}; for (let i = 0; i < n; i++) { const k = decode(); o[k] = decode(); } return o; }
      if ((b & 0xf0) === 0x90) { const n = b & 0xf; const a = []; for (let i = 0; i < n; i++) a.push(decode()); return a; }
      if ((b & 0xe0) === 0xa0) return rStr(b & 0x1f);
      if ((b & 0xe0) === 0xe0) return b - 256;
      switch (b) {
        case 0xc0: return null; case 0xc2: return false; case 0xc3: return true;
        case 0xc4: return rBin(ru8());  case 0xc5: return rBin(ru16()); case 0xc6: return rBin(ru32());
        case 0xca: return rf32();       case 0xcb: return rf64();
        case 0xcc: return ru8();        case 0xcd: return ru16();      case 0xce: return ru32(); case 0xcf: return ru64();
        case 0xd0: return ri8();        case 0xd1: return ri16();      case 0xd2: return ri32(); case 0xd3: return ri64();
        case 0xd9: return rStr(ru8());  case 0xda: return rStr(ru16()); case 0xdb: return rStr(ru32());
        case 0xdc: { const n = ru16(); const a = []; for (let i = 0; i < n; i++) a.push(decode()); return a; }
        case 0xdd: { const n = ru32(); const a = []; for (let i = 0; i < n; i++) a.push(decode()); return a; }
        case 0xde: { const n = ru16(); const o = {}; for (let i = 0; i < n; i++) { const k = decode(); o[k] = decode(); } return o; }
        case 0xdf: { const n = ru32(); const o = {}; for (let i = 0; i < n; i++) { const k = decode(); o[k] = decode(); } return o; }
        default: throw new Error('msgpack 0x' + b.toString(16));
      }
    }
    return decode();
  }

  function q1Match(bytes, sig) {
    if (bytes.length < sig.length) return false;
    for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
    return true;
  }

  function tryDecodeWithFragment(socket, buf) {
    const s = stateOf(socket);
    const now = performance.now();
    let combined = buf;
    if (s.fragBuf && (now - s.fragAt) <= FRAG_TTL_MS) {
      const a = new Uint8Array(s.fragBuf);
      const b = new Uint8Array(buf);
      const merged = new Uint8Array(a.byteLength + b.byteLength);
      merged.set(a, 0);
      merged.set(b, a.byteLength);
      combined = merged.buffer;
      metric('ingest.parser.fragment_merge').inc();
    } else if (s.fragBuf) {
      s.fragBuf = null;
    }
    try {
      const decoded = msgpackDecode(combined);
      s.fragBuf = null;
      return { decoded, buffer: combined };
    } catch (_) {
      s.fragBuf = combined;
      s.fragAt = now;
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Text frame parser
  // ──────────────────────────────────────────────────────────────────────
  function parseText(socket, txt) {
    metric('ingest.parser.text_frames').inc();
    if (!txt || txt === '2' || txt === '3') return;
    const s = stateOf(socket);

    // "45N-[event,...]" — header for an upcoming binary attachment
    if (txt.startsWith('45')) {
      const d = txt.indexOf('-');
      if (d === -1) return;
      try {
        const arr = JSON.parse(txt.slice(d + 1));
        if (Array.isArray(arr) && typeof arr[0] === 'string') {
          s.pendingName = arr[0];
          s.pendingAt = performance.now();
        }
      } catch (_) { metric('ingest.parser.malformed').inc(); }
      return;
    }

    // "42[event,payload]" — text event with inline payload
    if (!txt.startsWith('42')) return;
    let payload;
    try { payload = JSON.parse(txt.slice(2)); }
    catch (_) { metric('ingest.parser.malformed').inc(); return; }
    if (!Array.isArray(payload) || payload.length < 1) return;
    const name = String(payload[0] || '');
    const data = payload.length > 1 ? payload[1] : null;
    emit({ kind: 'json', name, payload: data, url: socket.url, ts: performance.now() });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Binary frame parser
  // ──────────────────────────────────────────────────────────────────────
  function parseBinary(socket, buf) {
    metric('ingest.parser.binary_frames').inc();
    const s = stateOf(socket);

    // Resolve the event name from the per-socket pending slot (TTL-guarded).
    let evName = 'binary';
    if (s.pendingName && (performance.now() - s.pendingAt) <= PENDING_TTL_MS) {
      evName = s.pendingName;
    }
    s.pendingName = '';

    // Q1 fast-path: leading "[[" suggests a JSON tick array.
    try {
      const bytes = new Uint8Array(buf);
      if (q1Match(bytes, Q1_SIG)) {
        metric('ingest.parser.q1_fast_path').inc();
        const txt = new TextDecoder().decode(bytes);
        const start = txt.indexOf('[[');
        if (start >= 0) {
          try {
            const arr = JSON.parse(txt.slice(start));
            emit({ kind: 'json', name: evName === 'binary' ? 'updateStream' : evName, payload: arr, url: socket.url, ts: performance.now() });
            return;
          } catch (_) {}
        }
      }
    } catch (_) {}

    // Standard path: msgpack with fragment buffering.
    const fr = tryDecodeWithFragment(socket, buf);
    if (!fr) return;
    emit({ kind: 'binary', name: evName, payload: fr.decoded, url: socket.url, ts: performance.now() });
  }

  function parseFrame(socket, data) {
    if (typeof data === 'string') {
      parseText(socket, data);
    } else if (data instanceof ArrayBuffer) {
      parseBinary(socket, data);
    } else if (data && data.buffer instanceof ArrayBuffer) {
      parseBinary(socket, data.buffer);
    } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
      data.arrayBuffer().then((ab) => parseBinary(socket, ab)).catch(() => {
        metric('ingest.parser.errors').inc();
      });
    }
  }

  QR.ingest = QR.ingest || {};
  QR.ingest.parser = { parseFrame, msgpackDecode };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
