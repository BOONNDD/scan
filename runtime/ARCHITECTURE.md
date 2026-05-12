# Quantum Runtime (V13) — Architecture

> A modular, event-driven, browser-native analytical execution framework for
> Pocket Option, designed to replace the monolithic `candle_V12_SUPREME_HYBRID.js`
> userscript with a fault-isolated, telemetry-driven runtime.

---

## 0. Document Map

1. Reverse engineering of the legacy V12 runtime
2. Structural weaknesses and runtime bottlenecks
3. Execution-flow maps (before / after)
4. New modular architecture
5. Optimization rationale
6. Telemetry strategy
7. Failure recovery strategy
8. Latency mitigation strategy
9. Module index

---

## 1. Reverse Engineering — Legacy V12 Conceptual Architecture

`candle_V12_SUPREME_HYBRID.js` is a single-file Tampermonkey userscript:

| Metric                         | Value          |
|--------------------------------|----------------|
| Total lines                    | 7,653          |
| Top-level declarations         | ~1,619         |
| `setInterval` polling loops    | 11             |
| `querySelector`/`getElementById` calls | 136    |
| Console instrumentation calls  | 1              |
| Logical sections (`§`)         | ~40+           |
| Workers                        | 0              |
| Typed-array buffers            | 0              |

**Conceptual flow** (recovered from section headers):

```
WebSocket hook (chat-po / events-po / demo-api-eu)
        │
        ▼
Binary fragment buffer (WeakMap per socket)
        │
        ▼
Tick stream (updateStream, updateAssets, successOpenOrder, …)
        │
        ▼
StreamingCandle aggregator   ──►   RollingATR
        │
        ▼
~30 retail indicators (RSI, MACD, BB, StochRSI, Fib, Ichimoku,
ADX, OBV, VWAP, Keltner, divergence, S/R, EMA cross, …)
        │
        ▼
Manually-weighted "SUPREME-PRED" confidence aggregator
        │
        ▼
PPT (Pattern Performance Tracker) 3-level Bayesian boost
        │
        ▼
ETC (Execution Timing Calibrator) — manual offset table
        │
        ▼
DOM click on Higher/Lower button (via 50+ selector fallbacks)
        │
        ▼
Result tracking via DOM mutation + WS open/close packets
```

Notable subsystems:

- **Per-WS `_pendingEvent` WeakMap**: race-condition fix between three concurrent
  socket.io connections that share `45N-` event-name framing.
- **AdaptiveCooldown**: cooldown = `min(TRADE_COOLDOWN_MS, 0.25 × candle_period)`.
- **Stream Watchdog**: 1-second `setInterval` checks `lastTickMs > 5000ms`.
- **Phantom candle injection**: "V13 PRE-CANDLE INJECTION ENGINE" injects a
  synthetic candle from current tick to allow earlier signal evaluation.
- **AI Signal Observer**: MutationObserver on platform DOM watching for
  Pocket Option's own AI badges to blend into confidence.
- **Islamic Account Guard**: disables IMDB (multi-trade) when an `islamic-account.min.css`
  stylesheet is loaded.

---

## 2. Structural Weaknesses & Bottlenecks

### 2.1 Architecture-level

| Weakness | Impact |
|----------|--------|
| Monolithic single-file IIFE | No fault isolation, one exception kills everything |
| ~1,600 mutable top-level bindings | High cognitive load, accidental shadowing, no module boundaries |
| Concerns interleaved per section | Feature extraction, prediction, execution and DOM in same lexical scope |
| Zero test surface | No exported pure functions, all live inside the IIFE |
| Zero worker offloading | RSI/MACD/BB/StochRSI/Ichimoku all run on the UI thread per tick |
| Indicator soup as primary signal | RSI/MACD/BB are lagging by design; combining 30 lagging indicators does not reduce lag |
| Single hardcoded ensemble | Static weight table per regime; no Bayesian or online updating |

### 2.2 Runtime bottlenecks

1. **Polling-heavy event loop**: 11 `setInterval` loops compete with WS-driven ticks.
   The "Stream Watchdog" runs every 1s, ETC HUD every 250ms, Signal Watcher every
   100ms — combined with the tick-driven path, this generates micro-jitter that
   destroys deterministic timing.
2. **Repeated DOM queries**: 136 `querySelector` calls, many inside hot paths
   (`executeTrade`, `_startSignalWatcher`). No caching of selector resolution.
3. **Allocation pressure**: Every tick creates ad-hoc objects for candles, indicators,
   features. There are zero ring buffers or object pools. Long sessions produce
   visible Major GC pauses (~100–300 ms each), which translates directly to
   missed entries on the fastest timeframes (1–5 s).
4. **Recompute storm**: Each indicator recomputes from scratch on every tick.
   Incremental EMA exists, but RSI/MACD/BB/StochRSI/ADX/OBV are full-recompute.
5. **No backpressure**: Burst packet arrival floods the indicator pipeline.
   Predictions queue up faster than they expire, producing stale executions.
6. **No worker isolation**: Heavy computation occupies the same thread that
   processes the WebSocket binary frames, causing self-induced latency spikes.
7. **DOM-coupled prediction**: Some prediction paths read from the DOM
   (asset name, period, payout). Any DOM mutation during platform updates
   silently degrades prediction quality.
8. **No structured telemetry**: Single `console.log` call. There is no
   structured metric stream, no histograms for latency, no anomaly counters,
   no audit trail. Failures are invisible until the user notices losses.
9. **Fragile selector chain**: ~50 fallback selectors hard-coded — when the
   platform rolls out a new build, recovery is manual.
10. **No deterministic shutdown**: `setInterval` IDs accumulate in `_v11_intervals`
    but workers, observers and the WS hook are never cleanly torn down.

### 2.3 Specific anti-patterns

- `W.__CANDLE_BOT_V12_SUPREME = true` guard, then the entire 7,653-line IIFE
  runs at `document-start` — no readiness gating, no progressive enhancement.
- `setInterval(fn, 100)` for signal watcher: 10 Hz polling for a stream that is
  itself reactive — pure waste.
- Indicator-decision fusion: confidence is computed *and* the trade is fired
  inside the same closure, so there is no way to AB-test prediction quality
  independently of execution quality.
- All state is module-private mutable. No snapshotting → no clean recovery.

---

## 3. Execution-Flow Map

### 3.1 Legacy (V12)

```
WS binary  ─┐
            │ (single thread, no buffer)
            ▼
        decode  ─►  candle build  ─►  30 indicators  ─►  confidence
                                          │ (recomputed full)
                                          ▼
                                      ETC offset table  ─►  DOM click
                          ▲                                    │
                          │ (every 100 ms setInterval)         │
                          └──── signal-watcher polling ────────┘
```

All inside one thread, one closure, one allocation graph.

### 3.2 New (V13 — Quantum Runtime)

```
WS binary
  │
  ▼
[INGEST]   ws_interceptor ─► binary_parser ─► packet_validator
                                  │
                                  ▼
                          ring-buffered Tick stream  ◄── object pool
                                  │
                                  ▼
[BUS]                event_bus (reactive, with backpressure)
       │              │              │              │
       ▼              ▼              ▼              ▼
  [FEATURES]    [REGIME]         [TELEMETRY]   [RECOVERY]
       │              │
       ▼              ▼
   FeatureFrame  ─►  regime tag
                          │
                          ▼
                  [PREDICT] (UI thread)  ──┐
                          │                │
                          ▼                ▼
                  [COMPUTE WORKER]   [INFERENCE WORKER]
                  momentum/meanrev   sequence (tfjs-lite)
                          │                │
                          └────────┬───────┘
                                   ▼
                           [ENSEMBLE]  ─►  [CALIBRATION]
                                   │
                                   ▼
                              [RISK]  (Kelly, drawdown, regime gate)
                                   │
                                   ▼
                       [EXECUTION TIMING ENGINE]
                                   │
                                   ▼
                          [DOM ACTUATOR]  ◄── self_healing selectors
                                   │
                                   ▼
                              click + audit
```

Each arrow is an event on the bus. Each box is an isolated module with its
own failure domain.

---

## 4. New Modular Architecture

Fifteen domains, each with a small, documented public surface. All cross-module
communication goes through the **event bus** — no direct imports of internal
state across domains.

```
runtime/
├── candle_V13_QUANTUM.user.js      ← Tampermonkey entry (loader + boot)
├── ARCHITECTURE.md                  ← this document
├── bundle.sh                        ← concatenation build
└── src/
    ├── core/
    │   ├── clock.js                 high-res monotonic clock + drift detection
    │   ├── ring_buffer.js           typed-array ring buffers (zero-alloc)
    │   ├── object_pool.js           pooled Tick / FeatureFrame / Prediction
    │   ├── scheduler.js             microtask + RIC + idle scheduling
    │   ├── event_bus.js             reactive pub/sub with backpressure
    │   └── kernel.js                lifecycle, DI container, supervisor
    ├── ingest/
    │   ├── ws_interceptor.js        WebSocket prototype hook
    │   ├── binary_parser.js         socket.io 4.5 binary framing
    │   ├── packet_validator.js      dedup, ordering, integrity
    │   └── tick_normalizer.js       canonical Tick struct
    ├── features/
    │   └── extractor.js             velocity, acceleration, entropy, pressure …
    ├── regime/
    │   └── classifier.js            adaptive regime FSM
    ├── predict/
    │   ├── models.js                six specialist models
    │   ├── ensemble.js              regime-conditioned weighted ensemble
    │   ├── sequence_inference.js    tfjs-lite browser inference adapter
    │   └── calibration.js           Platt + drift correction
    ├── risk/
    │   └── risk_engine.js           fractional Kelly + exposure + drawdown
    ├── execution/
    │   ├── timing_engine.js         ETC + latency compensation
    │   ├── dom_actuator.js          resilient click executor
    │   └── pipeline.js              full pred→exec orchestrator
    ├── dom/
    │   └── self_healing.js          selector registry + auto-rebind
    ├── workers/
    │   ├── compute_worker.js        Blob-spawned compute worker
    │   └── orchestrator.js          worker lifecycle + restart
    ├── telemetry/
    │   ├── metrics.js               counters / gauges / histograms
    │   ├── hud.js                   debug overlay
    │   └── diagnostics.js           copyable diagnostic reports
    └── recovery/
        └── watchdog.js              snapshots + restart + degraded mode
```

Each module exports a small public API on the global `QR` namespace
(`window.__QR__`) and registers its event subscriptions in `kernel.js`.
The userscript loader bundles these modules in dependency order.

---

## 5. Optimization Rationale

| Concern | Solution |
|---------|----------|
| GC pauses on hot path | Typed-array ring buffers + object pools for Tick / FeatureFrame / Prediction. Zero allocations on the per-tick path after warm-up. |
| Recompute storm | Every feature is **incremental** (Welford for variance, EMA accumulators, online entropy with sliding window). |
| Indicator lag | Replace lagging indicators with microstructure features (tick velocity, directional acceleration, pressure imbalance, entropy shifts). |
| UI-thread contention | All ensemble math + sequence inference is offloaded to a Blob-spawned Worker; UI thread only schedules and consumes results. |
| Burst handling | Event bus has a per-channel high-water mark and an adaptive batcher — bursts collapse into batched emissions; predictions never run more than once per X ms regardless of tick rate. |
| Timer drift | Every scheduled task uses `performance.now()` against an anchor; the clock module reports drift to telemetry. |
| Closure allocation | Hot functions take pre-allocated context objects; no inline arrow functions on the per-tick path. |
| DOM query cost | Selectors are registered once, resolved lazily, cached, and re-bound by the self-healing module on mutation. |

---

## 6. Telemetry Strategy

Telemetry is a first-class **producer/consumer pipeline**, not a logger.

### 6.1 Metric types
- **Counter**: monotonically increasing (ticks_total, packets_dropped, trades_executed).
- **Gauge**: instantaneous value (event_loop_lag_ms, current_regime).
- **Histogram**: latency distributions (inference_ms_p50/p95/p99, click_to_ack_ms).
- **Ringed event log**: last N anomalies / failures.

### 6.2 Required signals
- `prediction.confidence_drift`: rolling correlation between calibrated
  confidence and realized win/loss.
- `inference.latency_ms`: time from FeatureFrame emit to ensemble output.
- `execution.delay_ms`: time from final-decision to DOM click ack.
- `ingest.packet_integrity_failures`: malformed or duplicate packets.
- `ingest.gap_ms`: time since last tick per asset (stream-stall detector).
- `worker.utilization`: % of last 10 s the compute worker was busy.
- `eventloop.lag_ms`: rolling lag based on a 50 ms beacon.
- `regime.switches_per_minute`: regime flap detector.
- `memory.heap_used_mb`: via `performance.memory` where available.

### 6.3 Surfaces
- Debug overlay (HUD) — opt-in, hidden by default.
- Copyable diagnostic dump — single function call returning a JSON blob.
- Audit log — every decision and every override, ring-buffered, timestamped.

---

## 7. Failure Recovery Strategy

Fail in small pieces, not all at once.

| Failure | Reaction |
|---------|----------|
| Worker crash | Orchestrator respawns; runtime auto-falls back to UI-thread eval; emits `worker.restart`. |
| WS disconnect | Ingest detects gap, emits `ingest.stalled`, pipeline pauses execution, watchdog waits for reconnect (handled by the platform), session-tagged audit entry written. |
| DOM mutation breaks selector | Self-healing module rotates to next fallback, emits `dom.rebind`. If all fallbacks fail → degraded mode (no execution, telemetry still runs). |
| Excessive packet loss | Adaptive buffer expands, predictions paused, regime tag forced to "unstable". |
| Repeated prediction-vs-realized divergence | Confidence calibrator inflates its variance, ensemble down-weights the affected model. |
| Heap pressure | Object pools shrink, ring buffers trim oldest, telemetry HUD throttles to 1 Hz. |
| Browser tab throttling | Clock detects clock-jump > 250 ms, runtime enters cooldown, no trades until two consecutive on-time beacons. |
| Hard crash / unhandled rejection | Kernel snapshots last known good state, reloads modules into degraded mode, emits `kernel.recovered`. |

**State snapshots** are written every 5 s to `localStorage` under a versioned
key; on boot, the kernel restores the last snapshot if its hash and version
match. Snapshots include: model weights, calibration parameters, regime memory,
recent-result window, ETC offset. They never include credentials or auth.

---

## 8. Latency Mitigation Strategy

Predictable latency beats average latency.

1. **Zero-copy ingest**: WebSocket binary frames are parsed in-place using
   `DataView` over the original `ArrayBuffer`; no `String.fromCharCode` round-trip
   on the hot path.
2. **Ring buffers**: All time-series live in pre-sized `Float64Array` ring
   buffers — fixed memory, fixed pointer arithmetic, no `Array#push`.
3. **Microtask scheduling**: After ingest, downstream notifications use
   `queueMicrotask` so they run before paint; only periodic telemetry uses
   `requestIdleCallback`.
4. **Worker isolation**: Heavy math is shipped to a worker via
   `Transferable` `ArrayBuffer`s, so there is no structured-clone cost on the
   per-frame path.
5. **Pipeline early-exit**: The execution pipeline has six gates
   (calibration, risk, session, drawdown, regime, timing). Any "no" short-circuits
   before doing more work.
6. **Drift compensation**: The timing engine learns the click-to-ack delay
   distribution and fires `ENTRY_DELAY` earlier when the next candle close is
   imminent, *only when* confidence × regime stability passes a joint threshold.
7. **Backpressure**: The event bus drops obsolete events when newer ones are
   already queued for the same channel. The freshest tick wins.

---

## 9. Module Index

| Module | Public surface | Domain |
|--------|---------------|--------|
| `core/clock.js`       | `now()`, `since()`, `driftMs()`        | Time |
| `core/ring_buffer.js` | `RingBuffer`, `FloatRingBuffer`        | Memory |
| `core/object_pool.js` | `Pool`, `tickPool`, `framePool`        | Memory |
| `core/scheduler.js`   | `micro()`, `idle()`, `every()`         | Scheduling |
| `core/event_bus.js`   | `on()`, `emit()`, `channel()`          | Messaging |
| `core/kernel.js`      | `boot()`, `shutdown()`, `register()`   | Lifecycle |
| `ingest/ws_interceptor.js` | `install()`                       | I/O |
| `ingest/binary_parser.js`  | `parseFrame()`                    | I/O |
| `ingest/packet_validator.js`| `validate()`, `dedupe()`         | I/O |
| `ingest/tick_normalizer.js`| `normalize()`                     | I/O |
| `features/extractor.js`    | `extract()`                       | Analytics |
| `regime/classifier.js`     | `classify()`, `tag()`             | Analytics |
| `predict/models.js`        | six `*Model` predict functions    | Analytics |
| `predict/ensemble.js`      | `predict()`                       | Analytics |
| `predict/sequence_inference.js` | `infer()`                    | Analytics |
| `predict/calibration.js`   | `calibrate()`, `update()`         | Analytics |
| `risk/risk_engine.js`      | `assess()`, `recordResult()`      | Risk |
| `execution/timing_engine.js`| `schedule()`, `recordAck()`      | Execution |
| `execution/dom_actuator.js`| `click()`                         | Execution |
| `execution/pipeline.js`    | `route()`                         | Execution |
| `dom/self_healing.js`      | `resolve()`, `register()`         | DOM |
| `workers/compute_worker.js`| (worker script source)            | Compute |
| `workers/orchestrator.js`  | `spawn()`, `dispatch()`, `restart()` | Compute |
| `telemetry/metrics.js`     | `counter()`, `gauge()`, `histogram()` | Telemetry |
| `telemetry/hud.js`         | `mount()`, `toggle()`             | Telemetry |
| `telemetry/diagnostics.js` | `snapshot()`, `report()`          | Telemetry |
| `recovery/watchdog.js`     | `arm()`, `pet()`, `restore()`     | Recovery |

---

## 10. Non-Goals

- This runtime is not a backtester. The legacy "mini-backtest at startup"
  is removed — backtesting belongs in an offline pipeline.
- This runtime is not a strategy generator. It executes a calibrated ensemble.
  Strategy ideation belongs offline.
- No browser-side training. Models are inference-only; weights either ship
  with the userscript or are loaded from a static URL chosen by the operator.
- No reliance on retail indicators as primary signals. RSI/MACD/BB are
  retained only as low-weight ensemble members.
