// ingest/tick_normalizer.js
// Canonical Tick + asset normalization + payout discovery + result correlation.
// All payload-shape logic ported from V12_SUPREME_HYBRID.
//
// Architecture:
//   Subscribes to `ingest.raw_event` and dispatches by `name`:
//     - updateStream / tick / quote / stream → extractTickFromArray + emit `tick`
//     - updateAssets                          → processUpdateAssets (payouts)
//     - successcloseOrder / closeOrder        → processCloseOrder (result correlation)
//     - successopenOrder                      → onOpenOrderSuccess (latency)
//     - chafor                                → updateAssetTimeframe
//     - updateCharts / saveCharts / loadHistoryPeriod / history → historical
//
//   Asset names are normalized exactly the way V12 normalizes them so that
//   payout / signal / result maps key on identical strings.
//
// Optimization:
//   - normalizeAsset is the hot-path string normalizer used everywhere.
//   - Tick objects come from the pool; consumers release them.
//
// Failure handling:
//   - Defensive shape probing: V12's payout parser scans each item for the
//     first numeric in [50, 100] (payout%) without depending on field order.
//   - Drops invalid prices / timestamps with a counter.
//
// Telemetry:
//   - ingest.normalizer.ticks_total / dropped
//   - ingest.normalizer.payouts_learned
//   - ingest.normalizer.close_orders / open_orders
//
// Integration:
//   Subscribes: `ingest.raw_event`. Emits: `tick`, `tick.historical`,
//   `ingest.event` (so execution/pipeline can correlate results).
//
// Latency:
//   O(items) for batched payloads; single field assignments for ticks.
//
// Memory:
//   Per-asset state map (seq, lastTs, lastPrice). Bounded.
//
// Survivability:
//   Never throws. If the platform changes a shape, the affected branch
//   stops emitting; telemetry surfaces the drop.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.ingest && QR.ingest.normalizer) return;

  const perAsset = new Map();   // normalized asset → { seq, lastTs, lastPrice }
  const assetPayouts = new Map();   // normalized asset → 0..1 payout fraction
  const assetIsOpen  = new Map();   // normalized asset → bool

  function metric(name) {
    const m = QR.metrics;
    return m ? m.counter(name) : { inc() {} };
  }

  // V12 normalization: strip leading #, remove separators, collapse otc suffix.
  function normalizeAsset(s) {
    return String(s || '').replace(/^#/, '').replace(/[/\\\-\s]/g, '').replace(/_?otc$/i, '_otc');
  }

  function getAssetState(asset) {
    let s = perAsset.get(asset);
    if (!s) {
      s = { seq: 0, lastTs: 0, lastPrice: 0 };
      perAsset.set(asset, s);
    }
    return s;
  }

  // Ported from V12 verbatim — handles both shape variants.
  function extractTickFromArray(arr) {
    if (!Array.isArray(arr)) return null;
    if (Array.isArray(arr[0]) && arr[0].length >= 3 && typeof arr[0][0] === 'string' && typeof arr[0][2] === 'number') {
      const price = arr[0][2];
      if (price > 0) return { asset: normalizeAsset(arr[0][0]), price, ts: arr[0][1] };
    }
    if (arr.length >= 3 && typeof arr[0] === 'string' && typeof arr[2] === 'number') {
      const price = arr[2];
      if (price > 0) return { asset: normalizeAsset(arr[0]), price, ts: arr[1] };
    }
    return null;
  }

  function extractChafor(decoded) {
    if (!Array.isArray(decoded) || !Array.isArray(decoded[0]) || decoded[0].length < 2) return null;
    const asset = String(decoded[0][0]).toUpperCase();
    const seconds = Number(decoded[0][1]);
    if (asset.length >= 3 && Number.isFinite(seconds) && seconds >= 0) {
      return { asset: normalizeAsset(asset), seconds };
    }
    return null;
  }

  function emitTick(asset, ts, price) {
    if (!asset || !Number.isFinite(ts) || !Number.isFinite(price) || price <= 0) {
      metric('ingest.normalizer.dropped').inc();
      return;
    }
    const tsMs = ts < 1e12 ? ts * 1000 : ts;
    const s = getAssetState(asset);
    s.seq++;
    s.lastTs = tsMs;
    s.lastPrice = price;

    const tick = QR.tickPool.acquire();
    tick.asset = asset;
    tick.ts = tsMs;
    tick.price = price;
    tick.seq = s.seq;
    tick.side = 0;
    metric('ingest.normalizer.ticks_total').inc();
    QR.bus.emit('tick', tick);
  }

  // V12's processUpdateAssets — probe each item for the first plausible
  // payout numeric and the first boolean (isOpen). Exact tuple order varies.
  function processUpdateAssets(decoded) {
    if (!Array.isArray(decoded)) return;
    let parsed = 0;
    for (const item of decoded) {
      if (!Array.isArray(item) || item.length < 3) continue;
      let symbol = null, payout = null, isOpen = null;
      for (const f of item) {
        if (symbol === null && typeof f === 'string' && f.length >= 2 && f.length <= 32 && /^[A-Z0-9_/-]+$/i.test(f)) {
          symbol = f;
        } else if (payout === null && typeof f === 'number' && f >= 50 && f <= 100) {
          payout = f;
        } else if (isOpen === null && typeof f === 'boolean') {
          isOpen = f;
        }
      }
      if (symbol && payout !== null) {
        const a = normalizeAsset(symbol);
        const frac = payout / 100;
        assetPayouts.set(a, frac);
        if (isOpen !== null) assetIsOpen.set(a, isOpen);
        if (QR.risk && QR.risk.setPayout) QR.risk.setPayout(a, frac);
        parsed++;
      }
    }
    if (parsed > 0) {
      const c = QR.metrics && QR.metrics.counter('ingest.normalizer.payouts_learned');
      if (c) c.inc(parsed);
      QR.bus.emit('ingest.payouts.updated', { count: parsed });
    }
  }

  // successcloseOrder — broker emits deal result with profit + percentProfit.
  function processCloseOrder(payload) {
    if (!payload) return;
    metric('ingest.normalizer.close_orders').inc();
    const deal = (payload.deals && payload.deals[0]) || payload;
    if (!deal) return;
    const asset = normalizeAsset(deal.asset || '');
    const win = deal.profit > 0;
    let payoutPct = null;
    if (typeof deal.percentProfit === 'number' && deal.percentProfit >= 50 && deal.percentProfit <= 100) {
      payoutPct = deal.percentProfit / 100;
    } else if (win && deal.profit && deal.amount && deal.amount > 0) {
      payoutPct = deal.profit / deal.amount;
    }
    if (payoutPct !== null && payoutPct > 0.5 && payoutPct < 2.0) {
      if (asset) assetPayouts.set(asset, payoutPct);
      if (QR.risk && QR.risk.setPayout && asset) QR.risk.setPayout(asset, payoutPct);
    }
    // Emit a canonical close event for the pipeline correlator.
    QR.bus.emit('ingest.event', {
      kind: 'json', name: 'successcloseOrder',
      payload: { asset, profit: deal.profit, amount: deal.amount, percentProfit: deal.percentProfit, id: deal.id },
      ts: performance.now(),
    });
  }

  function onOpenOrderSuccess(payload) {
    metric('ingest.normalizer.open_orders').inc();
    QR.bus.emit('ingest.event', { kind: 'json', name: 'successopenOrder', payload, ts: performance.now() });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Dispatch
  // ──────────────────────────────────────────────────────────────────────
  function dispatch(event) {
    if (!event) return;
    const name = event.name;
    const data = event.payload;

    if (name === 'updateStream' || name === 'tick' || name === 'quote' || name === 'stream') {
      const tick = extractTickFromArray(data);
      if (tick) {
        emitTick(tick.asset, tick.ts, tick.price);
      } else if (Array.isArray(data)) {
        for (const item of data) {
          const t = extractTickFromArray(Array.isArray(item) ? item : [item]);
          if (t) emitTick(t.asset, t.ts, t.price);
        }
      }
      QR.bus.emit('ingest.event', event);
      return;
    }
    if (name === 'updateAssets') {
      processUpdateAssets(data);
      QR.bus.emit('ingest.event', event);
      return;
    }
    if (name === 'successcloseOrder' || name === 'closeOrder') {
      processCloseOrder(data);
      return;
    }
    if (name === 'successopenOrder') {
      onOpenOrderSuccess(data);
      return;
    }
    if (name === 'chafor') {
      const cf = extractChafor(Array.isArray(data) ? data : [data]);
      if (cf) QR.bus.emit('asset.timeframe', cf);
      QR.bus.emit('ingest.event', event);
      return;
    }
    if (name === 'loadHistoryPeriod' || name === 'updateCharts' || name === 'history') {
      QR.bus.emit('tick.historical', data);
      QR.bus.emit('ingest.event', event);
      return;
    }
    if (name === 'changeSymbol' && data && data.asset) {
      QR.bus.emit('asset.active', { asset: normalizeAsset(data.asset), source: 'changeSymbol' });
      QR.bus.emit('ingest.event', event);
      return;
    }

    // Unknown events still flow on the generic ingest.event channel.
    QR.bus.emit('ingest.event', event);
  }

  function init() {
    QR.bus.on('ingest.raw_event', dispatch);
  }

  QR.ingest = QR.ingest || {};
  QR.ingest.normalizer = {
    dispatch,
    normalizeAsset,
    extractTickFromArray,
    processUpdateAssets,
    processCloseOrder,
    getPayouts: () => new Map(assetPayouts),
    getOpenMap: () => new Map(assetIsOpen),
  };
  if (QR.kernel) QR.kernel.register('ingest.normalizer', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
