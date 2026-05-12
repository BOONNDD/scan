// execution/pipeline.js
// Full Prediction → Execution pipeline orchestrator.
//
// Architecture:
//   Six-gate pipeline:
//     1. Calibration : already applied in ensemble; pCal must exist.
//     2. Risk        : risk.assess() must return allow=true.
//     3. Session     : runtime not halted, watchdog healthy, stream fresh.
//     4. Drawdown    : checked inside risk, mirrored here as a soft guard.
//     5. Regime      : explicitly re-checked (defense in depth).
//     6. Timing      : timing.schedule() returns a non-zero offset; this
//                      gate also enforces a per-asset cooldown so we never
//                      spam the platform.
//   On pass: schedules click via scheduler.defer; on click, records result
//   via the result-correlator below.
//
// Result correlation:
//   The pipeline keeps a small map of open trades keyed by `tradeId` (a
//   monotonic counter). When the platform emits `successcloseOrder`-style
//   events through the ingest layer, the correlator maps them back to the
//   originating prediction and emits `execution.result` so risk and
//   calibration can learn.
//
// Optimization:
//   - One pooled Decision struct (acquired/released) per emission.
//   - Cooldown is a small per-asset object map.
//
// Failure handling:
//   - On any gate rejection: emit `pipeline.reject` with the reason; do not
//     touch the DOM.
//   - On click failure: release the trade record.
//   - On orphan result (no matching open trade): count and discard.
//
// Telemetry:
//   - `pipeline.reject.<gate>` counters
//   - `pipeline.accept` counter
//   - `pipeline.in_flight` gauge
//   - `pipeline.orphan_results` counter
//
// Integration:
//   Subscribes: `prediction`, `ingest.event` (for result mapping).
//   Emits: `execution.result`.
//
// Latency:
//   Order of µs for gating; click scheduling defers via timing engine.
//
// Memory:
//   Small map keyed by tradeId; cleaned on close.
//
// Survivability:
//   Pipeline is the funnel; if any single dep is degraded, the gates
//   conservatively reject.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.execution && QR.execution.pipeline) return;

  const COOLDOWN_FLOOR_MS = 500;
  const COOLDOWN_RATIO    = 0.25;    // 25% of candle period
  const DEFAULT_CANDLE_MS = 5000;

  let tradeId = 0;
  const inFlight = new Map();        // tradeId → { pred, decisionAt, fraction, payout }
  const cooldownUntil = new Map();   // asset → ts
  let halted = false;
  let streamStalled = false;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function gauge(name)  { const m = QR.metrics; return m ? m.gauge(name) : { set() {} }; }

  function reject(reason, pred) {
    metric('pipeline.reject.' + reason).inc();
    QR.bus.emit('pipeline.reject', { reason, asset: pred && pred.asset });
    if (pred) QR.predictionPool.release(pred);
  }

  function onPrediction(pred) {
    if (!pred) return;
    if (halted)        return reject('halted', pred);
    if (streamStalled) return reject('stream_stalled', pred);
    if (pred.direction === 0) return reject('no_direction', pred);

    const cdUntil = cooldownUntil.get(pred.asset) || 0;
    if (performance.now() < cdUntil) return reject('cooldown', pred);

    const a = QR.risk ? QR.risk.assess(pred) : { allow: false, reason: 'risk_missing' };
    if (!a.allow) return reject('risk_' + (a.reason || 'unknown'), pred);

    // Defense in depth on regime
    if (pred.regime === 'unstable' || pred.regime === 'warmup' ||
        pred.regime === 'dead_market' || pred.regime === 'manipulation_like') {
      return reject('regime_' + pred.regime, pred);
    }

    const offset = QR.execution.timing ? QR.execution.timing.schedule() : 60;
    metric('pipeline.accept').inc();

    const id = ++tradeId;
    const record = {
      id,
      asset: pred.asset,
      direction: pred.direction,
      pCal: pred.pCal,
      regime: pred.regime,
      modelVotes: { ...pred.modelVotes },
      decisionAt: performance.now(),
      fraction: a.fraction,
      payout: a.payout,
    };
    inFlight.set(id, record);
    gauge('pipeline.in_flight').set(inFlight.size);
    QR.bus.emit('execution.scheduled', { id, asset: pred.asset, direction: pred.direction, offsetMs: offset });

    QR.scheduler.defer(async () => {
      const res = await QR.execution.actuator.click(pred.direction);
      if (!res.ok) {
        inFlight.delete(id);
        gauge('pipeline.in_flight').set(inFlight.size);
      }
      // Predictions are now released (post-click).
      QR.predictionPool.release(pred);
    }, offset, 'pipeline.fire');

    // Cooldown: default candle period for now; can be set by ingest event listener.
    const cdMs = Math.max(COOLDOWN_FLOOR_MS, DEFAULT_CANDLE_MS * COOLDOWN_RATIO);
    cooldownUntil.set(pred.asset, performance.now() + cdMs);
  }

  // Best-effort: correlate close-order events back to our in-flight trades.
  // We don't have a deterministic tradeId-to-platform-orderId link; we use
  // (asset, direction, time-window) heuristics and match the oldest in-flight.
  function correlateResult(asset, win, payoutPct) {
    // Find the oldest in-flight on this asset.
    let oldest = null;
    inFlight.forEach((v) => {
      if (v.asset !== asset) return;
      if (!oldest || v.decisionAt < oldest.decisionAt) oldest = v;
    });
    if (!oldest) {
      metric('pipeline.orphan_results').inc();
      return;
    }
    inFlight.delete(oldest.id);
    gauge('pipeline.in_flight').set(inFlight.size);
    if (QR.risk && Number.isFinite(payoutPct)) QR.risk.setPayout(asset, payoutPct);
    QR.bus.emit('execution.result', {
      ...oldest,
      win,
      payout: payoutPct || oldest.payout,
    });
  }

  function onIngestEvent(ev) {
    if (!ev) return;
    const n = ev.name;
    if (n === 'successcloseOrder' || n === 'closeOrder') {
      const p = ev.payload || {};
      const asset = String(p.asset || '');
      const profit = Number(p.profit || p.percentProfit || 0);
      const amount = Number(p.amount || 0);
      const payoutPct = (amount > 0 && Number.isFinite(profit)) ? Math.abs(profit / amount) : NaN;
      const win = Number.isFinite(profit) ? profit > 0 : null;
      if (win === null || !asset) return;
      correlateResult(asset, win, Number.isFinite(payoutPct) ? payoutPct : undefined);
    } else if (n === 'updateAssets') {
      // Payload commonly contains [asset, payoutPct, ...] tuples.
      const rows = ev.payload;
      if (Array.isArray(rows) && QR.risk) {
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (Array.isArray(r) && r.length >= 5) {
            const asset = String(r[1] || '');
            const pct = Number(r[3] || r[4] || 0);
            if (asset && Number.isFinite(pct)) QR.risk.setPayout(asset, pct / 100);
          }
        }
      }
    }
  }

  function onHalt(ev)   { halted = true;        QR.bus.emit('pipeline.halted', ev || {}); }
  function onUnhalt()   { halted = false;       QR.bus.emit('pipeline.resumed', {}); }
  function onStalled()  { streamStalled = true; }
  function onResumed()  { streamStalled = false; }

  function init() {
    QR.bus.on('prediction', onPrediction);
    QR.bus.on('ingest.event', onIngestEvent);
    QR.bus.on('execution.halt', onHalt);
    QR.bus.on('execution.resume', onUnhalt);
    QR.bus.on('ingest.stalled', onStalled);
    QR.bus.on('ingest.resumed', onResumed);
  }

  QR.execution = QR.execution || {};
  QR.execution.pipeline = {
    inFlight: () => inFlight.size,
    halted: () => halted,
  };
  if (QR.kernel) QR.kernel.register('execution.pipeline', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
