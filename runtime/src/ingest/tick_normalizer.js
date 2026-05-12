// ingest/tick_normalizer.js
// Canonical Tick — convert platform-shaped events into pooled Tick objects.
//
// Architecture:
//   The platform emits several event names. We care primarily about
//   `updateStream` (live ticks) and `loadHistoryPeriod` / `updateCharts`
//   (historical candles). For each `updateStream` payload we acquire a
//   Tick from the pool, populate canonical fields, run the validator's
//   sequence/dedup, and emit it on the `tick` channel.
//
//   For historical candles we emit a `tick.historical` event for one-shot
//   warm-up of feature buffers — they are not routed through the prediction
//   pipeline.
//
// Optimization:
//   - Per-asset monotonic seq counter, bumped on each tick → free dedup key.
//   - Tick objects are pooled; the consumer is responsible for releasing
//     them after the frame is built.
//
// Failure handling:
//   - Unknown event names ignored.
//   - Non-finite numerics drop the tick and increment a counter.
//
// Telemetry:
//   - `ingest.normalizer.ticks_total`
//   - `ingest.normalizer.dropped`
//   - `ingest.normalizer.assets_seen`  (cardinality gauge, sampled)
//
// Integration:
//   Subscribes to `ingest.validated_event`. Emits on `tick` and `tick.historical`.
//
// Latency:
//   Single pool acquire + a handful of property assignments.
//
// Memory:
//   Tick objects come from a 4096-slot pool. Per-asset state map is tiny.
//
// Survivability:
//   Never throws. If the platform changes its event shapes, the normalizer
//   stops emitting ticks → recovery layer notices stream stall and
//   self-healing inspects DOM/version for an update.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.ingest && QR.ingest.normalizer) return;

  const perAsset = new Map();   // asset → { seq, lastTs, lastPrice }
  let assetsCardinality = 0;

  function metric(name) {
    const m = QR.metrics;
    return m ? m.counter(name) : { inc() {} };
  }

  function getAssetState(asset) {
    let s = perAsset.get(asset);
    if (!s) {
      s = { seq: 0, lastTs: 0, lastPrice: 0 };
      perAsset.set(asset, s);
      assetsCardinality++;
    }
    return s;
  }

  function emitTick(asset, ts, price) {
    if (!asset || !Number.isFinite(ts) || !Number.isFinite(price)) {
      metric('ingest.normalizer.dropped').inc();
      return;
    }
    const s = getAssetState(asset);
    s.seq++;
    s.lastTs = ts;
    s.lastPrice = price;

    const tick = QR.tickPool.acquire();
    tick.asset = asset;
    tick.ts = ts;
    tick.price = price;
    tick.seq = s.seq;
    tick.side = 0;
    metric('ingest.normalizer.ticks_total').inc();
    QR.bus.emit('tick', tick);
  }

  function handleUpdateStream(payload) {
    // Platform shape: array of arrays — [asset, ts(seconds), price]
    // Sometimes: { asset, ts, price } — handle defensively.
    if (Array.isArray(payload)) {
      for (let i = 0; i < payload.length; i++) {
        const row = payload[i];
        if (Array.isArray(row) && row.length >= 3) {
          const asset = String(row[0]);
          const tsRaw = +row[1];
          const ts = tsRaw < 1e12 ? tsRaw * 1000 : tsRaw;
          const price = +row[2];
          emitTick(asset, ts, price);
        } else if (row && typeof row === 'object') {
          const asset = String(row.asset || '');
          const ts = +(row.ts || row.time || Date.now());
          const price = +(row.price || row.close || 0);
          emitTick(asset, ts, price);
        }
      }
      return;
    }
    if (payload && typeof payload === 'object') {
      const asset = String(payload.asset || '');
      const ts = +(payload.ts || payload.time || Date.now());
      const price = +(payload.price || payload.close || 0);
      emitTick(asset, ts, price);
    }
  }

  function handleHistorical(payload) {
    if (!payload) return;
    QR.bus.emit('tick.historical', payload);
  }

  function dispatch(event) {
    if (!event) return;
    const name = event.name;
    if (name === 'updateStream') {
      handleUpdateStream(event.payload);
    } else if (name === 'loadHistoryPeriod' || name === 'updateCharts' || name === 'history') {
      handleHistorical(event.payload);
    }
    // Other event names (updateAssets, successopenOrder, successcloseOrder, …)
    // are observed by the execution layer for payout/result side-channels.
    QR.bus.emit('ingest.event', event);
  }

  function init() {
    QR.bus.on('ingest.validated_event', dispatch);
  }

  QR.ingest = QR.ingest || {};
  QR.ingest.normalizer = { dispatch, assetsCardinality: () => assetsCardinality };
  if (QR.kernel) QR.kernel.register('ingest.normalizer', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
