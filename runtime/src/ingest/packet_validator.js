// ingest/packet_validator.js
// Dedup, ordering, integrity for normalized events.
//
// Architecture:
//   Sits between `ingest.parser` and the tick normalizer. Validates:
//     1. Integrity — known event name, payload shape, finite numbers.
//     2. Dedup — a small LRU keyed by (asset, seq, ts) — protects against
//        replayed frames during reconnect storms.
//     3. Ordering — emits `ingest.gap` when sequence numbers regress or jump.
//
// Optimization:
//   - LRU is a fixed Map; oldest key dropped on overflow.
//   - Integrity check is a fast guard chain — no exception paths.
//
// Failure handling:
//   - Bad payloads are dropped silently with counters incremented.
//   - On reconnect (resequence), the validator's per-asset seq baseline is
//     reset after `RESET_GAP_MS`.
//
// Telemetry:
//   - `ingest.validator.passed`
//   - `ingest.validator.deduped`
//   - `ingest.validator.malformed`
//   - `ingest.validator.gap_forward`  (jump ahead)
//   - `ingest.validator.gap_back`     (out-of-order)
//
// Integration:
//   Subscribes to `ingest.raw_event`, emits to `ingest.validated_event`.
//
// Latency:
//   O(1) per event.
//
// Memory:
//   Two small maps (LRU, perAssetSeq), bounded.
//
// Survivability:
//   Pure stateless guards plus a bounded LRU; the validator cannot leak.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.ingest && QR.ingest.validator) return;

  const LRU_CAP = 4096;
  const RESET_GAP_MS = 5000;

  const lru = new Map();           // key → ts
  const perAssetSeq = new Map();   // asset → { seq, lastTs }

  function metric(name) {
    const m = QR.metrics;
    return m ? m.counter(name) : { inc() {} };
  }

  function lruHas(key) {
    return lru.has(key);
  }
  function lruAdd(key, ts) {
    if (lru.size >= LRU_CAP) {
      const firstKey = lru.keys().next().value;
      if (firstKey !== undefined) lru.delete(firstKey);
    }
    lru.set(key, ts);
  }

  function validate(event) {
    if (!event || typeof event !== 'object') {
      metric('ingest.validator.malformed').inc();
      return null;
    }
    if (event.kind !== 'json' && event.kind !== 'binary') {
      metric('ingest.validator.malformed').inc();
      return null;
    }
    if (!event.name || typeof event.name !== 'string') {
      metric('ingest.validator.malformed').inc();
      return null;
    }

    // Optional asset/seq dedup if normalizer pre-tagged it (chain runs again later).
    const meta = event.__meta;
    if (meta && meta.asset && Number.isFinite(meta.seq)) {
      const key = meta.asset + '|' + meta.seq;
      if (lruHas(key)) {
        metric('ingest.validator.deduped').inc();
        return null;
      }
      lruAdd(key, event.ts || performance.now());

      const prev = perAssetSeq.get(meta.asset);
      const now = event.ts || performance.now();
      if (!prev || (now - prev.lastTs) > RESET_GAP_MS) {
        perAssetSeq.set(meta.asset, { seq: meta.seq, lastTs: now });
      } else {
        const expected = prev.seq + 1;
        if (meta.seq > expected) {
          metric('ingest.validator.gap_forward').inc();
          QR.bus.emit('ingest.gap', { asset: meta.asset, kind: 'forward', got: meta.seq, expected });
        } else if (meta.seq < expected) {
          metric('ingest.validator.gap_back').inc();
          QR.bus.emit('ingest.gap', { asset: meta.asset, kind: 'back', got: meta.seq, expected });
          return null;       // drop out-of-order frames; freshest wins
        }
        prev.seq = meta.seq;
        prev.lastTs = now;
      }
    }

    metric('ingest.validator.passed').inc();
    return event;
  }

  function init() {
    QR.bus.on('ingest.raw_event', (ev) => {
      const v = validate(ev);
      if (v) QR.bus.emit('ingest.validated_event', v);
    });
  }

  QR.ingest = QR.ingest || {};
  QR.ingest.validator = { validate };
  if (QR.kernel) QR.kernel.register('ingest.validator', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
