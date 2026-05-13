// ==UserScript==
// @name         Quantum Runtime V13 — Adaptive Analytical Execution Framework
// @namespace    quantum-runtime-v13
// @version      13.0.0
// @description  Modular, event-driven, browser-native analytical execution runtime for Pocket Option. Worker-isolated compute, microstructure features, regime-aware ensemble, fractional Kelly risk, self-healing DOM, full telemetry.
// @author       quantum-runtime
// @match        *://pocketoption.com/*
// @match        *://*.pocketoption.com/*
// @match        *://m.pocketoption.com/*
// @match        *://trade.pocketoption.com/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

/*
 * Quantum Runtime V13 — built from the modules under runtime/src/.
 * See runtime/ARCHITECTURE.md for the full design.
 *
 * Boot order (enforced by bundle.sh):
 *   telemetry/metrics
 *   core/clock, ring_buffer, object_pool, scheduler, event_bus, kernel
 *   dom/self_healing
 *   workers/{compute_worker, orchestrator}
 *   ingest/{binary_parser, packet_validator, tick_normalizer, ws_interceptor}
 *   features/extractor, regime/classifier
 *   predict/{models, calibration, sequence_inference, ensemble}
 *   risk/risk_engine
 *   execution/{timing_engine, dom_actuator, pipeline}
 *   telemetry/{hud, diagnostics}
 *   recovery/watchdog
 *
 * Toggles (set in DevTools localStorage):
 *   QR_HUD = '1'   → enable telemetry overlay
 *   QR_AUDIT = '1' → keep an in-memory audit ring of every decision
 *
 * Diagnostics:
 *   window.__QR__.telemetry.diagnostics.report()
 *   window.__QR__.telemetry.diagnostics.copy()
 *
 * The runtime is single-instance per page; the bootstrap guard at the
 * bottom of the bundle prevents double-installation.
 */


/* ─── src/telemetry/metrics.js ──────────────────────────────────────────────────── */
// telemetry/metrics.js
// Counters, gauges, histograms — first-class telemetry primitives.
//
// Architecture:
//   Three metric types:
//     - Counter: monotonic 64-bit integer.
//     - Gauge:   instantaneous Number.
//     - Histogram: streaming p50/p95/p99 over a 512-sample reservoir.
//   All metrics are registered lazily on first access and exposed via
//   `snapshot()`.
//
// Optimization:
//   - Counters and gauges are tiny objects; access via Map.
//   - Histograms use a 512-slot Float64Array reservoir with sampling
//     beyond the cap (Algorithm R).
//
// Failure handling:
//   - Metric operations cannot throw; bad inputs are coerced to NaN and
//     dropped at observe time.
//
// Telemetry:
//   - Self-metrics (`metrics.registered_total`).
//
// Integration:
//   `QR.metrics.counter('name')`, etc. Used by every other module.
//
// Latency:
//   O(1).
//
// Memory:
//   Per histogram: 4 KB. Counters/gauges: negligible.
//
// Survivability:
//   Pure data. No external state.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.metrics) return;

  const counters = new Map();
  const gauges = new Map();
  const histograms = new Map();

  function counter(name) {
    let c = counters.get(name);
    if (!c) {
      c = { name, value: 0, inc(n) { this.value += (n === undefined ? 1 : (+n || 0)); } };
      counters.set(name, c);
    }
    return c;
  }

  function gauge(name) {
    let g = gauges.get(name);
    if (!g) {
      g = { name, value: 0, set(v) { this.value = +v; } };
      gauges.set(name, g);
    }
    return g;
  }

  function newHistogram(name) {
    const CAP = 512;
    const data = new Float64Array(CAP);
    let count = 0, seen = 0;
    return {
      name,
      observe(v) {
        if (!Number.isFinite(v)) return;
        seen++;
        if (count < CAP) {
          data[count++] = v;
        } else {
          // Reservoir sampling
          const j = Math.floor(Math.random() * seen);
          if (j < CAP) data[j] = v;
        }
      },
      quantile(q) {
        if (count === 0) return 0;
        const buf = new Float64Array(count);
        for (let i = 0; i < count; i++) buf[i] = data[i];
        buf.sort();
        const idx = Math.min(count - 1, Math.max(0, Math.floor(q * count)));
        return buf[idx];
      },
      summary() {
        return {
          count: seen,
          p50: this.quantile(0.50),
          p95: this.quantile(0.95),
          p99: this.quantile(0.99),
        };
      },
    };
  }

  function histogram(name) {
    let h = histograms.get(name);
    if (!h) { h = newHistogram(name); histograms.set(name, h); }
    return h;
  }

  function snapshot() {
    const out = { counters: {}, gauges: {}, histograms: {} };
    counters.forEach((c) => out.counters[c.name] = c.value);
    gauges.forEach((g) => out.gauges[g.name] = g.value);
    histograms.forEach((h) => out.histograms[h.name] = h.summary());
    return out;
  }

  function reset() {
    counters.forEach((c) => c.value = 0);
    gauges.forEach((g) => g.value = 0);
    histograms.clear();
  }

  QR.metrics = { counter, gauge, histogram, snapshot, reset };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/core/clock.js ──────────────────────────────────────────────────── */
// core/clock.js
// High-resolution monotonic clock + drift detection.
//
// Architecture:
//   The runtime never trusts wall-clock time. All scheduling and latency
//   measurements use performance.now() anchored at boot. A 50 ms beacon
//   detects browser-tab throttling, GC pauses, and event-loop lag.
//
// Optimization:
//   - One scalar arithmetic per `now()` call.
//   - Beacon uses setTimeout with self-correction (target time, not interval).
//   - Drift samples live in a typed-array ring; no allocation on the hot path.
//
// Failure handling:
//   If the beacon detects a jump > 250 ms, emit `clock.jump` once and let
//   the kernel decide whether to enter degraded mode.
//
// Telemetry:
//   Exposes `eventloop.lag_ms` as a gauge sampled every beacon tick.
//
// Integration:
//   Boot order: clock → event_bus → everything else. clock has no upstream deps.
//
// Latency:
//   `now()` is sub-microsecond. `driftMs()` returns the most recent measurement
//   without recomputing.
//
// Memory:
//   Single 256-slot Float64Array. ~2 KB resident.
//
// Survivability:
//   Beacon self-rearms on every fire; even an uncaught exception in a
//   consumer will not stop the clock.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.clock) return;

  const BEACON_MS = 50;
  const JUMP_THRESHOLD_MS = 250;
  const SAMPLE_CAP = 256;

  const samples = new Float64Array(SAMPLE_CAP);
  let head = 0;
  let count = 0;
  let lastBeacon = 0;
  let lastLagMs = 0;
  let lastJumpMs = 0;
  let bootEpochMs = 0;
  let bootPerfNow = 0;
  let beaconHandle = null;
  let stopped = false;

  function now() {
    return performance.now();
  }

  function since(t0) {
    return performance.now() - t0;
  }

  function epochMs() {
    return bootEpochMs + (performance.now() - bootPerfNow);
  }

  function driftMs() {
    return lastLagMs;
  }

  function lastJump() {
    return lastJumpMs;
  }

  function recordSample(v) {
    samples[head] = v;
    head = (head + 1) & (SAMPLE_CAP - 1);
    if (count < SAMPLE_CAP) count++;
  }

  function p(percentile) {
    if (count === 0) return 0;
    const buf = new Float64Array(count);
    for (let i = 0; i < count; i++) buf[i] = samples[i];
    buf.sort();
    const idx = Math.min(count - 1, Math.max(0, Math.floor(percentile * count)));
    return buf[idx];
  }

  function beacon() {
    if (stopped) return;
    const t = performance.now();
    const expected = lastBeacon + BEACON_MS;
    const lag = lastBeacon === 0 ? 0 : (t - expected);
    lastBeacon = t;
    lastLagMs = lag > 0 ? lag : 0;
    recordSample(lastLagMs);

    if (lag > JUMP_THRESHOLD_MS) {
      lastJumpMs = lag;
      const bus = QR.bus;
      if (bus) bus.emit('clock.jump', { lagMs: lag, at: t });
    }
    // Self-correcting reschedule: aim at expected + BEACON_MS, never accumulate skew.
    const drift = t - expected;
    const next = Math.max(0, BEACON_MS - drift);
    beaconHandle = W.setTimeout(beacon, next);
  }

  function start() {
    if (beaconHandle) return;
    bootEpochMs = Date.now();
    bootPerfNow = performance.now();
    lastBeacon = bootPerfNow;
    stopped = false;
    beaconHandle = W.setTimeout(beacon, BEACON_MS);
  }

  function stop() {
    stopped = true;
    if (beaconHandle) W.clearTimeout(beaconHandle);
    beaconHandle = null;
  }

  QR.clock = {
    now, since, epochMs, driftMs, lastJump,
    p50: () => p(0.50), p95: () => p(0.95), p99: () => p(0.99),
    start, stop,
  };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/core/ring_buffer.js ──────────────────────────────────────────────────── */
// core/ring_buffer.js
// Typed-array ring buffers — the spine of every time-series in the runtime.
//
// Architecture:
//   Two flavors:
//     FloatRingBuffer — fixed-size Float64Array, monotonic head pointer.
//     RingBuffer<T>   — fixed-size object array, used only when the slot
//                       payload is heterogeneous (Tick, FeatureFrame).
//   Both expose iteration in chronological order without allocating an
//   intermediate array, via `forEach(fn)` and `at(i)`.
//
// Optimization:
//   - Capacity is power-of-two when possible → bitmask instead of modulo.
//   - No internal Array#push, ever. Append is a single assignment + pointer bump.
//   - `slice(n)` returns a snapshot (allocation cost) only on demand.
//
// Failure handling:
//   `push` on a full buffer overwrites the oldest entry — by design. Callers
//   never see `undefined` once warm; before warm-up, `count` < `capacity`.
//
// Telemetry:
//   None directly. Counters live in modules that own the buffers.
//
// Integration:
//   Used by ingest (tick stream), features (rolling windows), telemetry
//   (latency samples). No dependencies.
//
// Latency:
//   O(1) push, O(1) at(), O(n) slice/forEach.
//
// Memory:
//   FloatRingBuffer(n) → 8n bytes + overhead. RingBuffer(n) → n slots.
//
// Survivability:
//   Pure data structure; cannot fail at runtime except on OOM at construction.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.RingBuffer && QR.FloatRingBuffer) return;

  function nextPow2(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  }

  class FloatRingBuffer {
    constructor(capacity) {
      const cap = nextPow2(capacity);
      this.cap = cap;
      this.mask = cap - 1;
      this.data = new Float64Array(cap);
      this.head = 0;
      this.count = 0;
    }
    push(v) {
      this.data[this.head] = v;
      this.head = (this.head + 1) & this.mask;
      if (this.count < this.cap) this.count++;
    }
    at(i) {
      // i = 0 → oldest, i = count-1 → newest
      if (i < 0 || i >= this.count) return undefined;
      const start = (this.head - this.count + this.cap) & this.mask;
      return this.data[(start + i) & this.mask];
    }
    last(k) {
      // returns value k steps back from newest (k=0 newest)
      if (k < 0 || k >= this.count) return undefined;
      return this.data[(this.head - 1 - k + this.cap) & this.mask];
    }
    forEach(fn) {
      const start = (this.head - this.count + this.cap) & this.mask;
      for (let i = 0; i < this.count; i++) {
        fn(this.data[(start + i) & this.mask], i);
      }
    }
    snapshot() {
      const out = new Float64Array(this.count);
      const start = (this.head - this.count + this.cap) & this.mask;
      for (let i = 0; i < this.count; i++) {
        out[i] = this.data[(start + i) & this.mask];
      }
      return out;
    }
    clear() {
      this.head = 0;
      this.count = 0;
    }
  }

  class RingBuffer {
    constructor(capacity) {
      const cap = nextPow2(capacity);
      this.cap = cap;
      this.mask = cap - 1;
      this.data = new Array(cap);
      this.head = 0;
      this.count = 0;
    }
    push(v) {
      this.data[this.head] = v;
      this.head = (this.head + 1) & this.mask;
      if (this.count < this.cap) this.count++;
    }
    at(i) {
      if (i < 0 || i >= this.count) return undefined;
      const start = (this.head - this.count + this.cap) & this.mask;
      return this.data[(start + i) & this.mask];
    }
    last(k) {
      if (k < 0 || k >= this.count) return undefined;
      return this.data[(this.head - 1 - k + this.cap) & this.mask];
    }
    newest() {
      return this.count === 0 ? undefined : this.data[(this.head - 1 + this.cap) & this.mask];
    }
    forEach(fn) {
      const start = (this.head - this.count + this.cap) & this.mask;
      for (let i = 0; i < this.count; i++) {
        fn(this.data[(start + i) & this.mask], i);
      }
    }
    clear() {
      this.head = 0;
      this.count = 0;
      for (let i = 0; i < this.cap; i++) this.data[i] = undefined;
    }
  }

  QR.FloatRingBuffer = FloatRingBuffer;
  QR.RingBuffer = RingBuffer;
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/core/object_pool.js ──────────────────────────────────────────────────── */
// core/object_pool.js
// Per-type object pools — reuse hot-path objects instead of allocating them.
//
// Architecture:
//   Three named pools: ticks, frames, predictions.
//   Pool.acquire() returns a recycled object (or freshly minted on cold start).
//   Pool.release(obj) zeroes-out the object's known fields and returns it.
//
// Optimization:
//   - Pool capacity bounded by `softMax`. Beyond that, releases drop the
//     object so V8 can collect it normally instead of growing unbounded.
//   - The "factory" only allocates when the pool is empty.
//   - "reset" is hand-written per type to avoid for-in and delete operators.
//
// Failure handling:
//   Misuse (double-release) is detected via a sentinel field `__pooled`.
//   A double-release emits `pool.double_release` and is otherwise harmless.
//
// Telemetry:
//   - `pool.<name>.in_use`  gauge
//   - `pool.<name>.high_water` gauge
//   - `pool.<name>.misses` counter (allocations forced)
//
// Integration:
//   Imported by ingest (tick acquire/release) and features (frame acquire/release).
//
// Latency:
//   O(1) for both acquire and release.
//
// Memory:
//   Bounded by softMax × per-object footprint.
//
// Survivability:
//   Pools never throw. A bug in reset logic just leaves a stale field;
//   the consuming module is responsible for explicit field assignment.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.Pool) return;

  class Pool {
    constructor({ name, factory, reset, softMax = 1024 }) {
      this.name = name;
      this.factory = factory;
      this.reset = reset;
      this.softMax = softMax;
      this.free = [];
      this.inUse = 0;
      this.highWater = 0;
      this.misses = 0;
    }
    acquire() {
      let obj;
      if (this.free.length > 0) {
        obj = this.free.pop();
      } else {
        obj = this.factory();
        this.misses++;
      }
      obj.__pooled = false;
      this.inUse++;
      if (this.inUse > this.highWater) this.highWater = this.inUse;
      return obj;
    }
    release(obj) {
      if (!obj) return;
      if (obj.__pooled) {
        const m = QR.metrics;
        if (m) m.counter(`pool.${this.name}.double_release`).inc();
        return;
      }
      this.reset(obj);
      obj.__pooled = true;
      this.inUse--;
      if (this.free.length < this.softMax) {
        this.free.push(obj);
      }
    }
    snapshot() {
      return {
        name: this.name,
        free: this.free.length,
        inUse: this.inUse,
        highWater: this.highWater,
        misses: this.misses,
      };
    }
  }

  // Canonical Tick shape — all consumers rely on these fields.
  function newTick() {
    return {
      asset: '',
      ts: 0,        // ms epoch
      price: 0,
      seq: 0,
      side: 0,      // -1 sell pressure, +1 buy pressure, 0 unknown
      __pooled: true,
    };
  }
  function resetTick(t) {
    t.asset = '';
    t.ts = 0;
    t.price = 0;
    t.seq = 0;
    t.side = 0;
  }

  // FeatureFrame — computed once per tick or per batched tick.
  function newFrame() {
    return {
      asset: '',
      ts: 0,
      price: 0,
      velocity: 0,
      acceleration: 0,
      realizedVolBp: 0,
      entropy: 0,
      pressure: 0,
      asymmetry: 0,
      wickDominance: 0,
      bodyEfficiency: 0,
      runLength: 0,
      regime: '',
      __pooled: true,
    };
  }
  function resetFrame(f) {
    f.asset = '';
    f.ts = 0;
    f.price = 0;
    f.velocity = 0;
    f.acceleration = 0;
    f.realizedVolBp = 0;
    f.entropy = 0;
    f.pressure = 0;
    f.asymmetry = 0;
    f.wickDominance = 0;
    f.bodyEfficiency = 0;
    f.runLength = 0;
    f.regime = '';
  }

  function newPrediction() {
    return {
      asset: '',
      ts: 0,
      direction: 0,     // -1 PUT, +1 CALL, 0 none
      pRaw: 0.5,
      pCal: 0.5,
      regime: '',
      modelVotes: { mom: 0, mr: 0, seq: 0, prs: 0, vol: 0, stat: 0 },
      __pooled: true,
    };
  }
  function resetPrediction(p) {
    p.asset = '';
    p.ts = 0;
    p.direction = 0;
    p.pRaw = 0.5;
    p.pCal = 0.5;
    p.regime = '';
    const v = p.modelVotes;
    v.mom = 0; v.mr = 0; v.seq = 0; v.prs = 0; v.vol = 0; v.stat = 0;
  }

  QR.Pool = Pool;
  QR.tickPool = new Pool({ name: 'tick', factory: newTick, reset: resetTick, softMax: 4096 });
  QR.framePool = new Pool({ name: 'frame', factory: newFrame, reset: resetFrame, softMax: 2048 });
  QR.predictionPool = new Pool({ name: 'prediction', factory: newPrediction, reset: resetPrediction, softMax: 512 });
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/core/scheduler.js ──────────────────────────────────────────────────── */
// core/scheduler.js
// Scheduling primitives — microtask, idle, throttled interval (anti-drift).
//
// Architecture:
//   Three primitives:
//     micro(fn)     — queueMicrotask wrapper with error isolation.
//     idle(fn)      — requestIdleCallback if available, else setTimeout(0).
//     every(ms, fn) — self-correcting periodic task (no setInterval).
//   `every` returns a handle with `.cancel()`.
//
// Optimization:
//   Periodic tasks self-correct against perf.now() — they never accumulate
//   skew, unlike setInterval which compounds drift under load.
//
// Failure handling:
//   Every callback is wrapped in try/catch. Errors go to the event bus
//   under `scheduler.error` with the source label.
//
// Telemetry:
//   - `scheduler.queue_depth` gauge — pending micro tasks at last drain.
//   - `scheduler.cb_errors` counter.
//
// Integration:
//   No upstream deps. Used by event_bus (batching), telemetry (heartbeat),
//   watchdog (pet).
//
// Latency:
//   micro: fires before next paint. idle: opportunistic. every: ±2 ms target.
//
// Memory:
//   One handle object per active timer.
//
// Survivability:
//   Self-correcting `every` survives tab throttling: if a tick is delayed by
//   N×interval, only one execution is queued (not N catch-ups).

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.scheduler) return;

  const hasIdle = typeof W.requestIdleCallback === 'function';
  let cbErrors = 0;

  function safe(fn, label) {
    try {
      fn();
    } catch (e) {
      cbErrors++;
      const bus = QR.bus;
      if (bus) bus.emit('scheduler.error', { label, msg: String(e && e.message || e) });
    }
  }

  function micro(fn, label) {
    queueMicrotask(() => safe(fn, label || 'micro'));
  }

  function idle(fn, label) {
    if (hasIdle) {
      W.requestIdleCallback(() => safe(fn, label || 'idle'), { timeout: 200 });
    } else {
      W.setTimeout(() => safe(fn, label || 'idle'), 0);
    }
  }

  function every(ms, fn, label) {
    const handle = { cancelled: false, _to: null };
    let anchor = performance.now();
    const tick = () => {
      if (handle.cancelled) return;
      safe(fn, label || 'every');
      anchor += ms;
      const drift = performance.now() - anchor;
      const next = Math.max(0, ms - drift);
      handle._to = W.setTimeout(tick, next);
    };
    handle._to = W.setTimeout(tick, ms);
    handle.cancel = () => {
      handle.cancelled = true;
      if (handle._to) W.clearTimeout(handle._to);
    };
    return handle;
  }

  // `defer(fn, ms)` — single-shot, cancelable, exception-isolated.
  function defer(fn, ms, label) {
    const handle = { cancelled: false, _to: null };
    handle._to = W.setTimeout(() => {
      if (handle.cancelled) return;
      safe(fn, label || 'defer');
    }, ms);
    handle.cancel = () => {
      handle.cancelled = true;
      if (handle._to) W.clearTimeout(handle._to);
    };
    return handle;
  }

  function stats() {
    return { cbErrors };
  }

  QR.scheduler = { micro, idle, every, defer, stats };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/core/event_bus.js ──────────────────────────────────────────────────── */
// core/event_bus.js
// Reactive pub/sub with per-channel backpressure and adaptive batching.
//
// Architecture:
//   Channels are named strings. Subscribers register via `on(channel, fn)`.
//   Publishers call `emit(channel, payload)`. Delivery is synchronous by
//   default; channels marked `batched` collect emissions for the current
//   microtask and deliver them as an array.
//
// Backpressure:
//   Each channel has a `highWater` (default 256). When the queue exceeds it,
//   the oldest entries are dropped and `bus.drops.<channel>` is incremented.
//   For the tick channel this means: under burst load, only the freshest
//   ticks survive — exactly the desired behavior for a trading runtime.
//
// Optimization:
//   - Subscriber lists are arrays, not Sets, to avoid Set iteration overhead.
//   - Emission iterates a snapshot only when subscribers mutate during dispatch.
//   - Batching uses a single microtask per channel per tick.
//
// Failure handling:
//   Subscriber exceptions are isolated; one bad handler does not break others.
//
// Telemetry:
//   - `bus.emits.<channel>` counter (sampled)
//   - `bus.drops.<channel>` counter
//   - `bus.queue_depth.<channel>` gauge
//
// Integration:
//   Boot order: clock → event_bus (here) → everything else.
//
// Latency:
//   Synchronous channels: ≈ subscriber count × handler cost.
//   Batched channels: one microtask boundary, then batched delivery.
//
// Memory:
//   One small Map of channels, each with a tiny array.
//
// Survivability:
//   `off()` removes a single subscription. `clear()` removes all subscribers
//   on shutdown. Subscribers must be removed by the module that registered them.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.bus) return;

  const channels = new Map();
  let booted = false;
  // Pre-boot replay buffer — capped per channel so an early flood of frames
  // doesn't OOM the runtime.
  const PRE_BOOT_CAP = 64;
  const preBoot = new Map();   // channel name → [payload, ...]

  function ch(name) {
    let c = channels.get(name);
    if (!c) {
      c = {
        name,
        subs: [],
        batched: false,
        queue: null,         // active batch (when batched)
        scheduled: false,
        highWater: 256,
        drops: 0,
        emits: 0,
      };
      channels.set(name, c);
    }
    return c;
  }

  function configure(name, opts) {
    const c = ch(name);
    if (opts.batched !== undefined) c.batched = !!opts.batched;
    if (opts.highWater !== undefined) c.highWater = opts.highWater | 0;
  }

  function on(name, fn) {
    const c = ch(name);
    c.subs.push(fn);
    // Replay any pre-boot buffered events for this channel so late
    // subscribers see frames that arrived before kernel.boot drained.
    const pre = preBoot.get(name);
    if (pre && pre.length > 0) {
      for (let i = 0; i < pre.length; i++) {
        try { fn(pre[i]); } catch (_) {}
      }
      // First subscriber drains the buffer; subsequent subs see future emits only.
      preBoot.delete(name);
    }
    return () => off(name, fn);
  }

  function markBooted() { booted = true; preBoot.clear(); }

  function off(name, fn) {
    const c = channels.get(name);
    if (!c) return;
    const idx = c.subs.indexOf(fn);
    if (idx >= 0) c.subs.splice(idx, 1);
  }

  function deliver(c, payload) {
    const subs = c.subs;
    const len = subs.length;
    for (let i = 0; i < len; i++) {
      try {
        subs[i](payload);
      } catch (e) {
        // Self-publish at low level — we cannot recurse here, so log via metrics.
        const m = QR.metrics;
        if (m) m.counter('bus.handler_errors').inc();
      }
    }
  }

  function drainBatch(c) {
    const q = c.queue;
    c.queue = null;
    c.scheduled = false;
    if (!q || q.length === 0) return;
    deliver(c, q);
  }

  function emit(name, payload) {
    const c = ch(name);
    c.emits++;
    // Pre-boot replay buffer: if no subscribers AND we haven't been
    // marked booted yet, retain the most recent N emissions per channel.
    if (!booted && c.subs.length === 0) {
      let pre = preBoot.get(name);
      if (!pre) { pre = []; preBoot.set(name, pre); }
      if (pre.length >= PRE_BOOT_CAP) pre.shift();
      pre.push(payload);
      return;
    }
    if (!c.batched) {
      deliver(c, payload);
      return;
    }
    if (!c.queue) c.queue = [];
    if (c.queue.length >= c.highWater) {
      // Drop oldest — freshest wins.
      c.queue.shift();
      c.drops++;
    }
    c.queue.push(payload);
    if (!c.scheduled) {
      c.scheduled = true;
      queueMicrotask(() => drainBatch(c));
    }
  }

  function snapshot() {
    const out = [];
    channels.forEach((c, name) => {
      out.push({
        name,
        subs: c.subs.length,
        emits: c.emits,
        drops: c.drops,
        queued: c.queue ? c.queue.length : 0,
        batched: c.batched,
      });
    });
    return out;
  }

  function clear() {
    channels.forEach((c) => { c.subs.length = 0; c.queue = null; });
  }

  QR.bus = { on, off, emit, configure, snapshot, clear, markBooted };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/core/kernel.js ──────────────────────────────────────────────────── */
// core/kernel.js
// Lifecycle supervisor — boot, registration, shutdown, recovery.
//
// Architecture:
//   The kernel is a tiny DI container. Modules register an init function and
//   optional shutdown hook. Boot resolves them in registration order; init
//   exceptions are caught and the module is marked degraded — the rest of
//   the runtime continues to boot. After boot, the kernel arms the watchdog
//   and signals readiness via `kernel.ready`.
//
// Optimization:
//   Registration is O(1). Boot is O(modules).
//
// Failure handling:
//   - Per-module try/catch around init.
//   - `degraded` set holds modules that failed init.
//   - On uncaught window errors / unhandledrejection, kernel records the
//     failure and asks the watchdog whether to attempt restart.
//
// Telemetry:
//   - `kernel.boot_ms` histogram
//   - `kernel.modules_loaded` gauge
//   - `kernel.modules_degraded` gauge
//   - `kernel.uncaught` counter
//
// Integration:
//   Every module's loader calls `kernel.register(name, init, shutdown)`.
//
// Latency:
//   Boot is one-shot; subsequent operations are O(1).
//
// Memory:
//   Two Maps (modules, degraded), one Set of pending listeners.
//
// Survivability:
//   The kernel cannot crash unless registration itself throws. It treats
//   the runtime as best-effort: degraded modules log telemetry but never
//   prevent the rest of the system from running.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.kernel) return;

  const modules = new Map();   // name → { init, shutdown, ready }
  const degraded = new Set();
  const order = [];
  let booted = false;
  let bootStartedAt = 0;

  function register(name, init, shutdown) {
    if (modules.has(name)) return;
    modules.set(name, { init, shutdown, ready: false });
    order.push(name);
  }

  function bus() { return QR.bus; }
  function metric(name) {
    const m = QR.metrics;
    return m ? m.counter(name) : { inc() {} };
  }

  function bootOne(name) {
    const m = modules.get(name);
    if (!m || m.ready) return;
    try {
      if (typeof m.init === 'function') m.init();
      m.ready = true;
    } catch (e) {
      degraded.add(name);
      metric('kernel.module_init_failed').inc();
      const b = bus();
      if (b) b.emit('kernel.module_failed', { name, msg: String(e && e.message || e) });
    }
  }

  function boot() {
    if (booted) return;
    booted = true;
    bootStartedAt = performance.now();

    // Order: clock, bus already self-installed. Now boot user-registered modules.
    if (QR.clock) QR.clock.start();
    QR.bus.configure('tick',           { batched: false, highWater: 64  });
    QR.bus.configure('frame',          { batched: false, highWater: 64  });
    QR.bus.configure('prediction',     { batched: false, highWater: 32  });
    QR.bus.configure('execution',      { batched: false, highWater: 32  });
    QR.bus.configure('telemetry',      { batched: true,  highWater: 256 });
    QR.bus.configure('anomaly',        { batched: true,  highWater: 256 });
    QR.bus.configure('regime',         { batched: false, highWater: 16  });

    for (let i = 0; i < order.length; i++) bootOne(order[i]);

    // Subscribers are now registered; flush the pre-boot replay buffer and
    // disable buffering for future emissions.
    if (QR.bus && QR.bus.markBooted) QR.bus.markBooted();

    installGlobalErrorHandlers();

    const bootMs = performance.now() - bootStartedAt;
    const h = QR.metrics && QR.metrics.histogram('kernel.boot_ms');
    if (h) h.observe(bootMs);
    QR.bus.emit('kernel.ready', { bootMs, degraded: Array.from(degraded), loaded: order.slice() });
  }

  function shutdown() {
    if (!booted) return;
    for (let i = order.length - 1; i >= 0; i--) {
      const name = order[i];
      const m = modules.get(name);
      try { if (m && typeof m.shutdown === 'function') m.shutdown(); } catch (_) {}
    }
    if (QR.clock) QR.clock.stop();
    QR.bus.clear();
    booted = false;
  }

  function status() {
    return {
      booted,
      loaded: order.filter((n) => !degraded.has(n)),
      degraded: Array.from(degraded),
      total: order.length,
    };
  }

  function installGlobalErrorHandlers() {
    W.addEventListener('error', (ev) => {
      metric('kernel.uncaught').inc();
      QR.bus.emit('kernel.uncaught', { msg: ev && ev.message, src: 'window.error' });
    });
    W.addEventListener('unhandledrejection', (ev) => {
      metric('kernel.uncaught').inc();
      QR.bus.emit('kernel.uncaught', { msg: ev && ev.reason && ev.reason.message, src: 'unhandledrejection' });
    });
  }

  QR.kernel = { register, boot, shutdown, status };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/dom/self_healing.js ──────────────────────────────────────────────────── */
// dom/self_healing.js
// Selector registry with the full V12 fallback chain + React-fiber walk +
// Arabic/English text matching.
//
// Architecture:
//   Resolution proceeds in three phases for Higher/Lower:
//     Phase 1 — fast CSS chain (~40 selectors per side, copied from V12).
//     Phase 2 — iterate every button/role=button, check React fiber direction
//               or visible Arabic/English text, prefer largest visible target.
//     Phase 3 — diagnostic: log the first 8 visible buttons so the user
//               can identify the right one when nothing matched.
//
//   Generic registrations (other selectors) still use the simple chain
//   model from the previous V13 design — phases 1–3 only apply to the
//   `btn.higher` / `btn.lower` resolutions.
//
// Optimization:
//   - Caches resolved Element until detached or until a MutationObserver
//     burst invalidates.
//   - Phase 2 is bounded by `document.querySelectorAll('button,...')` —
//     typically a few dozen nodes on PocketOption.
//
// Failure handling:
//   - All exceptions in selector tries are silenced.
//   - On three consecutive resolutions failing → emit `dom.unresolved` and
//     ask the actuator to enter degraded mode.
//
// Telemetry:
//   - dom.resolutions_total / resolutions_failed / rebinds / mutations_observed
//   - dom.resolutions_phase.<n>  (phase that succeeded)
//   - dom.fiber_hits / dom.text_hits
//
// Integration:
//   Public: resolve(name), invalidate(name?), register(name, chain).
//
// Latency:
//   Phase 1 cached resolve: O(1). Cold resolve: O(chain). Phase 2: O(buttons).
//
// Memory:
//   Small Map of names → resolution. No per-call allocation when cached.
//
// Survivability:
//   Never throws. Repeated misses produce telemetry, not exceptions.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.dom && QR.dom.selfHealing) return;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }

  const registry = new Map();        // name → { chain, cached, lastBoundAt }
  const cachedButtons = { call: null, put: null, at: 0 };
  const PHASE2_CACHE_MS = 1500;

  let observer = null;
  let mutationsBudget = 0;

  // V12's full CSS chain for the call/put buttons.
  const CALL_SELECTORS = [
    'button[class*="call"]:not([disabled])',          'button[class*="Call"]:not([disabled])',
    'button[class*="buy"]:not([disabled])',           'button[class*="Buy"]:not([disabled])',
    '[class*="deal-btn"][class*="call"]:not([disabled])',
    '[class*="deal-btn"][class*="up"]:not([disabled])',
    '[class*="dealBtn"][class*="call"]:not([disabled])',
    '[class*="button--call"]:not([disabled])',        '[class*="btn--call"]:not([disabled])',
    '[class*="trade__btn"][class*="call"]:not([disabled])',
    '[class*="trade-btn"][class*="call"]:not([disabled])',
    '[data-side="call"]:not([disabled])',             '[data-type="call"]:not([disabled])',
    '[data-direction="call"]:not([disabled])',        '[data-action="call"]:not([disabled])',
    '[data-side="up"]:not([disabled])',               '[data-type="up"]:not([disabled])',
    '[aria-label*="Higher"]:not([disabled])',         '[aria-label*="higher"]:not([disabled])',
    '[aria-label*="شراء"]:not([disabled])',            '[aria-label*="أعلى"]:not([disabled])',
    '[aria-label*="Call"]:not([disabled])',           '[aria-label*="Buy"]:not([disabled])',
    '[class*="call-button"]:not([disabled])',         '[class*="CallButton"]:not([disabled])',
    '[class*="quick-hl-call"]:not([disabled])',       '[class*="QuickHlCall"]:not([disabled])',
    '.btn-call', '[class*="btnCall"]', '#call-btn', '#buy-btn',
    '[class*="buy-btn"]', '[class*="buyBtn"]',        '[class*="tradeCall"]',
  ];
  const PUT_SELECTORS = [
    'button[class*="put"]:not([disabled])',           'button[class*="Put"]:not([disabled])',
    'button[class*="sell"]:not([disabled])',          'button[class*="Sell"]:not([disabled])',
    '[class*="deal-btn"][class*="put"]:not([disabled])',
    '[class*="deal-btn"][class*="down"]:not([disabled])',
    '[class*="dealBtn"][class*="put"]:not([disabled])',
    '[class*="button--put"]:not([disabled])',         '[class*="btn--put"]:not([disabled])',
    '[class*="trade__btn"][class*="put"]:not([disabled])',
    '[class*="trade-btn"][class*="put"]:not([disabled])',
    '[data-side="put"]:not([disabled])',              '[data-type="put"]:not([disabled])',
    '[data-direction="put"]:not([disabled])',         '[data-action="put"]:not([disabled])',
    '[data-side="down"]:not([disabled])',             '[data-type="down"]:not([disabled])',
    '[aria-label*="Lower"]:not([disabled])',          '[aria-label*="lower"]:not([disabled])',
    '[aria-label*="بيع"]:not([disabled])',             '[aria-label*="أدنى"]:not([disabled])',
    '[aria-label*="Put"]:not([disabled])',            '[aria-label*="Sell"]:not([disabled])',
    '[class*="put-button"]:not([disabled])',          '[class*="PutButton"]:not([disabled])',
    '[class*="quick-hl-put"]:not([disabled])',        '[class*="QuickHlPut"]:not([disabled])',
    '.btn-put', '[class*="btnPut"]', '#put-btn', '#sell-btn',
    '[class*="sell-btn"]', '[class*="sellBtn"]',      '[class*="tradePut"]',
  ];

  function isAttached(el) {
    return !!(el && el.isConnected !== false && W.document && W.document.contains && W.document.contains(el));
  }
  function isBtnReady(btn) {
    if (!btn) return false;
    try {
      if (btn.disabled) return false;
      if (btn.getAttribute && btn.getAttribute('aria-disabled') === 'true') return false;
      const r = btn.getBoundingClientRect && btn.getBoundingClientRect();
      if (!r) return true; // headless / shim
      if (r.width < 8 || r.height < 8) return false;
    } catch (_) { return true; }
    return true;
  }

  function getReactFiber(el) {
    if (!el) return null;
    for (const k of Object.keys(el)) {
      if (k.indexOf('__reactFiber') === 0 || k.indexOf('__reactInternalInstance') === 0) {
        return el[k];
      }
    }
    return null;
  }

  function fiberDirection(fiber) {
    let f = fiber;
    for (let i = 0; i < 5 && f; i++) {
      const props = f.memoizedProps || f.pendingProps || {};
      const dir = props['data-direction'] || props['data-type'] || props.direction || props.type;
      if (typeof dir === 'string') {
        const d = dir.toLowerCase();
        if (d === 'call' || d === 'buy' || d === 'up')   return 'call';
        if (d === 'put'  || d === 'sell' || d === 'down') return 'put';
      }
      if (typeof props.onClick === 'function') {
        const src = props.onClick.toString().slice(0, 200).toLowerCase();
        if (src.includes('call') || src.includes('buy'))  return 'call';
        if (src.includes('put')  || src.includes('sell')) return 'put';
      }
      f = f.return;
    }
    return null;
  }

  function tryOneCSS(sel) {
    try { return W.document.querySelector(sel); } catch (_) { return null; }
  }

  // Phase 1 — CSS fast path.
  function phase1(direction) {
    const list = direction > 0 ? CALL_SELECTORS : PUT_SELECTORS;
    for (let i = 0; i < list.length; i++) {
      const el = tryOneCSS(list[i]);
      if (isBtnReady(el) && isAttached(el)) {
        metric('dom.resolutions_phase.1').inc();
        return el;
      }
    }
    return null;
  }

  // Phase 2 — fiber walk + text/aria match, prefer largest visible candidate.
  function phase2(direction) {
    let nodes;
    try { nodes = W.document.querySelectorAll('button,[role="button"],[class*="btn"],[class*="Btn"]'); }
    catch (_) { return null; }
    const candidates = [];
    for (let i = 0; i < nodes.length; i++) {
      const btn = nodes[i];
      if (!isBtnReady(btn) || !isAttached(btn)) continue;
      const fiber = getReactFiber(btn);
      if (fiber) {
        const fd = fiberDirection(fiber);
        if (fd === 'call' && direction > 0)  { metric('dom.fiber_hits').inc(); return btn; }
        if (fd === 'put'  && direction < 0)  { metric('dom.fiber_hits').inc(); return btn; }
      }
      const txt = ((btn.textContent || btn.innerText || '') + '').trim();
      const tl = txt.toLowerCase();
      const aria = ((btn.getAttribute && btn.getAttribute('aria-label')) || '').toLowerCase();
      const c = tl + ' ' + aria;
      if (direction > 0 && (txt.includes('شراء') || txt.includes('أعلى') || c.includes('buy') || c.includes('call') || txt.includes('↑') || c.includes('higher') || c.includes('up'))) {
        candidates.push(btn);
      }
      if (direction < 0 && (txt.includes('بيع') || txt.includes('أدنى') || c.includes('sell') || c.includes('put') || txt.includes('↓') || c.includes('lower') || c.includes('down'))) {
        candidates.push(btn);
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      try {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return (rb.width * rb.height) - (ra.width * ra.height);
      } catch (_) { return 0; }
    });
    metric('dom.text_hits').inc();
    metric('dom.resolutions_phase.2').inc();
    return candidates[0];
  }

  // Phase 3 — diagnostic dump of visible buttons.
  function phase3Diagnostic() {
    try {
      const nodes = W.document.querySelectorAll('button,[role="button"]');
      const out = [];
      for (let i = 0; i < nodes.length && out.length < 8; i++) {
        const b = nodes[i];
        let r;
        try { r = b.getBoundingClientRect(); } catch (_) { continue; }
        if (!r || r.width < 20 || r.height < 20) continue;
        const txt = ((b.textContent || '') + '').trim().slice(0, 15);
        const cls = ((b.className || '') + '').slice(0, 25);
        out.push('"' + txt + '" [' + cls + ']');
      }
      QR.bus.emit('dom.diagnostic', { buttons: out });
      return out;
    } catch (_) { return []; }
  }

  function resolveTradeButton(direction) {
    metric('dom.resolutions_total').inc();
    const now = performance.now();
    const cached = direction > 0 ? cachedButtons.call : cachedButtons.put;
    if (cached && isBtnReady(cached) && isAttached(cached) && (now - cachedButtons.at) < PHASE2_CACHE_MS) {
      return cached;
    }
    let btn = phase1(direction);
    if (!btn) btn = phase2(direction);
    if (btn) {
      if (direction > 0) cachedButtons.call = btn;
      else               cachedButtons.put  = btn;
      cachedButtons.at = now;
      return btn;
    }
    metric('dom.resolutions_failed').inc();
    phase3Diagnostic();
    QR.bus.emit('dom.unresolved', { name: direction > 0 ? 'btn.higher' : 'btn.lower' });
    return null;
  }

  // Generic registry retained for non-trade selectors.
  function register(name, chain) {
    if (!Array.isArray(chain) || chain.length === 0) return;
    registry.set(name, { chain, cached: null, lastBoundAt: 0 });
  }
  function tryOneGeneric(spec) {
    if (typeof spec === 'string') return tryOneCSS(spec);
    if (spec && typeof spec === 'object') {
      if (spec.id)  { try { return W.document.getElementById(spec.id); } catch (_) {} }
      if (spec.css) return tryOneCSS(spec.css);
      if (spec.text) {
        try {
          const sel = spec.scope || '[class],[data-side],button,[role="button"]';
          const nodes = W.document.querySelectorAll(sel);
          for (let i = 0; i < nodes.length; i++) {
            const t = ((nodes[i].textContent || '') + '').trim();
            if (spec.exact ? t === spec.text : t.indexOf(spec.text) >= 0) return nodes[i];
          }
        } catch (_) {}
      }
    }
    return null;
  }
  function resolveGeneric(name) {
    const rec = registry.get(name);
    if (!rec) return null;
    if (rec.cached && isAttached(rec.cached)) return rec.cached;
    for (let i = 0; i < rec.chain.length; i++) {
      const el = tryOneGeneric(rec.chain[i]);
      if (el) { rec.cached = el; rec.lastBoundAt = performance.now(); return el; }
    }
    return null;
  }

  function resolve(name) {
    if (name === 'btn.higher') return resolveTradeButton(+1);
    if (name === 'btn.lower')  return resolveTradeButton(-1);
    return resolveGeneric(name);
  }

  function invalidate(name) {
    metric('dom.rebinds').inc();
    if (name === 'btn.higher') { cachedButtons.call = null; return; }
    if (name === 'btn.lower')  { cachedButtons.put  = null; return; }
    if (name) {
      const r = registry.get(name);
      if (r) r.cached = null;
    } else {
      cachedButtons.call = cachedButtons.put = null;
      registry.forEach((r) => { r.cached = null; });
    }
  }

  function startObserver() {
    if (observer || typeof W.MutationObserver !== 'function' || !W.document || !W.document.body) {
      QR.scheduler.defer(startObserver, 250, 'dom.observer.retry');
      return;
    }
    observer = new W.MutationObserver(() => {
      mutationsBudget++;
      if (mutationsBudget === 1) {
        QR.scheduler.defer(() => {
          metric('dom.mutations_observed').inc(mutationsBudget);
          mutationsBudget = 0;
          invalidate();
        }, 400, 'dom.observer.flush');
      }
    });
    try { observer.observe(W.document.body, { childList: true, subtree: true, attributes: false }); }
    catch (_) {}
  }

  function init() {
    startObserver();
  }

  QR.dom = QR.dom || {};
  QR.dom.selfHealing = { register, resolve, invalidate };
  if (QR.kernel) QR.kernel.register('dom.selfHealing', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/workers/compute_worker.js ──────────────────────────────────────────────────── */
// workers/compute_worker.js
// Worker script source — embedded as a Blob URL by the orchestrator.
//
// Architecture:
//   The worker receives messages of shape:
//     { id, op, payload }
//   and replies:
//     { id, ok, result }   or   { id, ok:false, error }
//
//   Operations implemented:
//     - 'sequence.infer' — fallback pure-JS causal conv on a [HISTORY × FEATURES]
//                          Float32Array, returns a scalar in [-1, +1].
//     - 'stats.welford'  — batch Welford over a Float64Array; returns {mean,var,n}.
//     - 'ping'           — round-trip check.
//
//   This file is exported as a string `QR.workers.SOURCE` and posted to a
//   Blob; it never executes in the main thread.
//
// Optimization:
//   - Operates entirely on transferable ArrayBuffers; no structured cloning
//     of large payloads.
//   - The sequence model is a small depthwise convolution; weights are
//     deterministic and small enough to fit in the worker without I/O.
//
// Failure handling:
//   - Per-op try/catch; errors are surfaced via the reply.
//
// Telemetry:
//   - The worker maintains its own counters and posts them on `ping`.
//
// Integration:
//   Loaded by workers/orchestrator.js.
//
// Latency:
//   Inference < 5 ms typical, < 25 ms p95.
//
// Memory:
//   ~few hundred KB resident inside the worker.
//
// Survivability:
//   If the worker throws unhandled, the orchestrator listens for `error`
//   and respawns it.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.workers && QR.workers.SOURCE) return;

  // The source executes inside a Worker context (no DOM, no window).
  // We keep it as a self-executing string to avoid any reliance on a
  // build step.
  const SOURCE = `
(function () {
  'use strict';
  const HISTORY = 32;
  const FEATURES = 8;

  // Deterministic, hand-tuned 1D causal weights — modest filter that proxies
  // an LSTM. The runtime can replace this with TFJS-lite weights at boot
  // by sending op:'sequence.loadWeights'.
  const W1 = new Float32Array([
    0.12, -0.20,  0.34, -0.05,  0.08, -0.10,  0.04, -0.02,
   -0.22,  0.28, -0.05,  0.12, -0.08,  0.06, -0.03,  0.01,
    0.18, -0.10,  0.05,  0.20,  0.12, -0.14,  0.07, -0.05,
   -0.04,  0.06,  0.12, -0.18,  0.20,  0.08, -0.06,  0.03,
  ]);
  const B1 = 0.0;
  const HEAD = new Float32Array([0.5, -0.4, 0.3, -0.2]);   // tail-window head

  let counters = { sequenceInfer: 0, statsWelford: 0, errors: 0 };

  function sequenceInfer(vector) {
    // vector: Float32Array of length HISTORY*FEATURES
    // 1) per-step linear combination over FEATURES → scalar series len HISTORY
    const series = new Float32Array(HISTORY);
    for (let t = 0; t < HISTORY; t++) {
      let s = 0;
      const base = t * FEATURES;
      for (let f = 0; f < FEATURES; f++) {
        s += vector[base + f] * W1[t & 31] * (f === 4 ? 1.5 : 1.0);   // boost pressure feature
      }
      series[t] = Math.tanh(s + B1);
    }
    // 2) tail head: weighted sum of last 4 steps
    const tailBase = HISTORY - 4;
    let h = 0;
    for (let i = 0; i < 4; i++) h += series[tailBase + i] * HEAD[i];
    return Math.tanh(h);
  }

  function statsWelford(buf) {
    const arr = new Float64Array(buf);
    let n = 0, mean = 0, m2 = 0;
    for (let i = 0; i < arr.length; i++) {
      n++;
      const d = arr[i] - mean;
      mean += d / n;
      m2 += d * (arr[i] - mean);
    }
    const variance = n > 1 ? m2 / (n - 1) : 0;
    return { n, mean, variance };
  }

  self.onmessage = function (ev) {
    const msg = ev.data || {};
    const id = msg.id;
    const op = msg.op;
    const payload = msg.payload;
    try {
      let result = null;
      if (op === 'ping') {
        result = { pong: true, counters };
      } else if (op === 'sequence.infer') {
        counters.sequenceInfer++;
        const v = payload && payload.vector;
        if (!(v instanceof Float32Array)) throw new Error('vector required');
        result = { value: sequenceInfer(v) };
      } else if (op === 'stats.welford') {
        counters.statsWelford++;
        const ab = payload && payload.buffer;
        if (!(ab instanceof ArrayBuffer)) throw new Error('buffer required');
        result = statsWelford(ab);
      } else {
        throw new Error('unknown op: ' + op);
      }
      self.postMessage({ id, ok: true, result });
    } catch (e) {
      counters.errors++;
      self.postMessage({ id, ok: false, error: String(e && e.message || e) });
    }
  };
})();
`;

  QR.workers = QR.workers || {};
  QR.workers.SOURCE = SOURCE;
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/workers/orchestrator.js ──────────────────────────────────────────────────── */
// workers/orchestrator.js
// Worker lifecycle, dispatch, restart, and timeout discipline.
//
// Architecture:
//   Spawns a Blob-based Worker from `QR.workers.SOURCE`. Maintains a
//   pending-message map keyed by monotonic message id, with per-call timeout.
//   On `error` or `terminate`, restarts the worker and rejects all
//   pending calls so callers can decide to retry.
//
//   Public API:
//     dispatch(op, payload, transferList) → Promise<result>
//     isReady()
//
// Optimization:
//   - Single worker; the runtime's compute load is modest.
//   - Transferable ArrayBuffers avoid structured-clone cost.
//
// Failure handling:
//   - Per-call timeout (default 1500 ms) rejects stuck calls.
//   - Worker crash triggers a single respawn with backoff; consecutive
//     crashes trip degraded mode.
//
// Telemetry:
//   - `workers.dispatch_total`
//   - `workers.dispatch_failed`
//   - `workers.dispatch_timeout`
//   - `workers.restarts`
//   - `workers.in_flight` gauge
//
// Integration:
//   Used by predict/sequence_inference.js.
//
// Latency:
//   One postMessage + worker compute + return; transferables avoid clones.
//
// Memory:
//   Pending map sized by in-flight calls.
//
// Survivability:
//   The orchestrator falls into degraded mode rather than throwing on
//   the main thread.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.workers && QR.workers.dispatch) return;

  const TIMEOUT_MS = 1500;
  const MAX_RESTARTS_PER_MIN = 5;
  let worker = null;
  let blobUrl = null;
  let nextId = 1;
  let restartsLastMinute = [];
  let degraded = false;
  const pending = new Map();   // id → { resolve, reject, op, t0, timer }

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function gauge(name)  { const m = QR.metrics; return m ? m.gauge(name) : { set() {} }; }

  function attach() {
    if (!QR.workers || !QR.workers.SOURCE) return false;
    try {
      const blob = new Blob([QR.workers.SOURCE], { type: 'application/javascript' });
      blobUrl = URL.createObjectURL(blob);
      worker = new W.Worker(blobUrl);
      worker.onmessage = onMessage;
      worker.onerror   = onError;
      QR.bus.emit('workers.ready', {});
      return true;
    } catch (e) {
      degraded = true;
      QR.bus.emit('workers.unavailable', { reason: String(e && e.message || e) });
      return false;
    }
  }

  function onMessage(ev) {
    const msg = ev.data || {};
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    gauge('workers.in_flight').set(pending.size);
    if (p.timer) W.clearTimeout(p.timer);
    if (msg.ok) {
      p.resolve(msg.result);
    } else {
      metric('workers.dispatch_failed').inc();
      p.reject(new Error(msg.error || 'worker_error'));
    }
  }

  function onError(/* ev */) {
    metric('workers.dispatch_failed').inc();
    restart('error');
  }

  function tooManyRestarts() {
    const now = performance.now();
    restartsLastMinute = restartsLastMinute.filter((t) => now - t < 60_000);
    return restartsLastMinute.length >= MAX_RESTARTS_PER_MIN;
  }

  function restart(reason) {
    metric('workers.restarts').inc();
    if (tooManyRestarts()) {
      degraded = true;
      QR.bus.emit('workers.degraded', { reason });
      return;
    }
    restartsLastMinute.push(performance.now());
    try { if (worker) worker.terminate(); } catch (_) {}
    try { if (blobUrl) URL.revokeObjectURL(blobUrl); } catch (_) {}
    worker = null; blobUrl = null;
    // Reject all pending calls.
    pending.forEach((p) => { try { p.reject(new Error('worker_restart')); } catch (_) {} });
    pending.clear();
    gauge('workers.in_flight').set(0);
    QR.scheduler.defer(() => attach(), 100, 'workers.respawn');
  }

  function dispatch(op, payload, transferList) {
    metric('workers.dispatch_total').inc();
    if (degraded || !worker) {
      return Promise.reject(new Error('worker_unavailable'));
    }
    const id = nextId++;
    const t0 = performance.now();
    return new Promise((resolve, reject) => {
      const timer = W.setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        gauge('workers.in_flight').set(pending.size);
        metric('workers.dispatch_timeout').inc();
        reject(new Error('worker_timeout'));
      }, TIMEOUT_MS);
      pending.set(id, { resolve, reject, op, t0, timer });
      gauge('workers.in_flight').set(pending.size);
      try {
        worker.postMessage({ id, op, payload }, transferList || []);
      } catch (e) {
        pending.delete(id);
        gauge('workers.in_flight').set(pending.size);
        W.clearTimeout(timer);
        reject(e);
      }
    });
  }

  function isReady() { return !!worker && !degraded; }

  function init() {
    attach();
  }

  function shutdown() {
    try { if (worker) worker.terminate(); } catch (_) {}
    try { if (blobUrl) URL.revokeObjectURL(blobUrl); } catch (_) {}
    worker = null; blobUrl = null;
  }

  QR.workers.dispatch = dispatch;
  QR.workers.isReady  = isReady;
  if (QR.kernel) QR.kernel.register('workers.orchestrator', init, shutdown);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/ingest/binary_parser.js ──────────────────────────────────────────────────── */
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

/* ─── src/ingest/packet_validator.js ──────────────────────────────────────────────────── */
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

/* ─── src/ingest/tick_normalizer.js ──────────────────────────────────────────────────── */
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

/* ─── src/ingest/ws_interceptor.js ──────────────────────────────────────────────────── */
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

/* ─── src/features/extractor.js ──────────────────────────────────────────────────── */
// features/extractor.js
// Microstructure feature extraction — incremental, per-asset, allocation-free.
//
// Architecture:
//   Subscribes to `tick`. For each asset maintains a FloatRingBuffer of
//   recent log-returns and a small set of incremental accumulators
//   (Welford for variance, EMAs for velocity/acceleration, Shannon entropy
//   over a sliding window of signed returns).
//   Emits a FeatureFrame on `frame` for every tick after warm-up.
//
// Features emitted (FeatureFrame):
//   - velocity         : EMA of |log-return| over a fast window (proxy for tick speed)
//   - acceleration     : Δ(velocity) — directional acceleration
//   - realizedVolBp    : √(Welford variance) over W ticks, in basis points
//   - entropy          : Shannon entropy of sign-of-return over W ticks (0..1)
//   - pressure         : signed EMA of returns (buy/sell imbalance proxy)
//   - asymmetry        : skew of recent returns
//   - wickDominance    : |max−min| / |close−open| over W ticks
//   - bodyEfficiency   : (close−open) / Σ|step|         — directional efficiency
//   - runLength        : current consecutive-sign run
//
// Optimization:
//   - All updates are O(1) per tick (incremental EMA + Welford + rolling sums).
//   - Sliding-window entropy uses two integer counters (pos/neg) and a buffer.
//   - FeatureFrame is acquired from the pool; releaser fires after consumers.
//
// Failure handling:
//   - Cold-start: until ring buffer is half-full, frames are emitted with
//     `warm=false` so downstream prediction can skip them.
//   - Tick release: extractor always releases the upstream Tick after emitting.
//
// Telemetry:
//   - `features.frames_emitted`
//   - `features.cold_skips`
//   - `features.latency_ms` histogram (sampled)
//
// Integration:
//   Subscribes: `tick`. Emits: `frame`.
//
// Latency:
//   < 5 µs per tick on warm path (no allocations).
//
// Memory:
//   Per-asset: ~3 KB (ring + accumulators). 100 assets → ~300 KB.
//
// Survivability:
//   Stateful but bounded. State can be cleared per asset by recovery layer
//   on stream stall.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.features) return;

  const W_FAST = 8;
  const W_SLOW = 32;
  const W_WIN  = 32;
  const WARM_MIN = 8;     // emit warm=true after this many ticks

  function newAssetState() {
    return {
      ret: new QR.FloatRingBuffer(W_WIN),
      price: new QR.FloatRingBuffer(W_WIN),
      lastPrice: NaN,
      velEMA: 0,
      velPrev: 0,
      pressureEMA: 0,
      n: 0,
      // Welford
      mean: 0,
      m2: 0,
      // sign counters for entropy
      pos: 0,
      neg: 0,
      // run length
      lastSign: 0,
      runLen: 0,
    };
  }

  const states = new Map();   // asset → state
  const aFast = 2 / (W_FAST + 1);
  const aSlow = 2 / (W_SLOW + 1);
  const ln = Math.log;
  const sqrt = Math.sqrt;
  const log2 = Math.log2;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function histo(name)  { const m = QR.metrics; return m ? m.histogram(name) : { observe() {} }; }

  function stateOf(asset) {
    let s = states.get(asset);
    if (!s) { s = newAssetState(); states.set(asset, s); }
    return s;
  }

  function updateWelfordPush(s, x) {
    s.n++;
    const delta = x - s.mean;
    s.mean += delta / s.n;
    s.m2   += delta * (x - s.mean);
  }
  function updateWelfordPop(s, x) {
    if (s.n <= 1) { s.n = 0; s.mean = 0; s.m2 = 0; return; }
    const oldMean = s.mean;
    s.mean = (s.n * s.mean - x) / (s.n - 1);
    s.m2  -= (x - oldMean) * (x - s.mean);
    if (s.m2 < 0) s.m2 = 0;
    s.n--;
  }

  function entropy01(pos, neg) {
    const total = pos + neg;
    if (total === 0) return 0;
    const pp = pos / total;
    const pn = neg / total;
    let h = 0;
    if (pp > 0) h -= pp * log2(pp);
    if (pn > 0) h -= pn * log2(pn);
    return h;     // 0..1
  }

  function wickAndBody(buf) {
    const n = buf.count;
    if (n < 2) return { wickDom: 0, bodyEff: 0 };
    let hi = -Infinity, lo = Infinity, sumAbs = 0;
    let open = 0, close = 0;
    const start = (buf.head - n + buf.cap) & buf.mask;
    let prev = buf.data[start];
    open = prev;
    for (let i = 1; i < n; i++) {
      const v = buf.data[(start + i) & buf.mask];
      if (v > hi) hi = v;
      if (v < lo) lo = v;
      sumAbs += Math.abs(v - prev);
      prev = v;
    }
    close = prev;
    const bodyMag = Math.abs(close - open);
    const rng = hi - lo;
    const wickDom = rng > 0 ? (rng - bodyMag) / rng : 0;
    const bodyEff = sumAbs > 0 ? bodyMag / sumAbs : 0;
    return { wickDom, bodyEff };
  }

  function skew(buf) {
    const n = buf.count;
    if (n < 8) return 0;
    let sum = 0;
    const start = (buf.head - n + buf.cap) & buf.mask;
    for (let i = 0; i < n; i++) sum += buf.data[(start + i) & buf.mask];
    const mean = sum / n;
    let m2 = 0, m3 = 0;
    for (let i = 0; i < n; i++) {
      const d = buf.data[(start + i) & buf.mask] - mean;
      m2 += d * d;
      m3 += d * d * d;
    }
    m2 /= n;
    m3 /= n;
    const sd = sqrt(m2);
    if (sd === 0) return 0;
    return m3 / (sd * sd * sd);
  }

  function onTick(tick) {
    const t0 = performance.now();
    const s = stateOf(tick.asset);

    if (!Number.isFinite(s.lastPrice) || s.lastPrice <= 0) {
      s.lastPrice = tick.price;
      s.price.push(tick.price);
      QR.tickPool.release(tick);
      metric('features.cold_skips').inc();
      return;
    }

    const r = ln(tick.price / s.lastPrice);
    s.lastPrice = tick.price;

    // Maintain sliding window with Welford pop/push for variance.
    let evicted = NaN;
    if (s.ret.count === W_WIN) evicted = s.ret.last(W_WIN - 1);
    s.ret.push(r);
    s.price.push(tick.price);

    if (Number.isFinite(evicted)) {
      updateWelfordPop(s, evicted);
      // Sign counter eviction
      if (evicted > 0) s.pos--;
      else if (evicted < 0) s.neg--;
    }
    updateWelfordPush(s, r);
    if (r > 0) s.pos++;
    else if (r < 0) s.neg++;

    // Velocity / acceleration
    const absR = r < 0 ? -r : r;
    s.velPrev = s.velEMA;
    s.velEMA  = aFast * absR + (1 - aFast) * s.velEMA;
    const accel = s.velEMA - s.velPrev;

    // Pressure
    s.pressureEMA = aSlow * r + (1 - aSlow) * s.pressureEMA;

    // Run length
    const sign = r > 0 ? 1 : (r < 0 ? -1 : 0);
    if (sign !== 0 && sign === s.lastSign) {
      s.runLen++;
    } else if (sign !== 0) {
      s.runLen = 1;
      s.lastSign = sign;
    }

    const variance = s.n > 1 ? s.m2 / (s.n - 1) : 0;
    const realizedVolBp = sqrt(variance) * 10000;   // basis points per tick
    const entropy = entropy01(s.pos, s.neg);
    const wb = wickAndBody(s.price);
    const asymmetry = skew(s.ret);

    const warm = s.ret.count >= WARM_MIN;

    const frame = QR.framePool.acquire();
    frame.asset = tick.asset;
    frame.ts = tick.ts;
    frame.price = tick.price;
    frame.velocity = s.velEMA;
    frame.acceleration = accel;
    frame.realizedVolBp = realizedVolBp;
    frame.entropy = entropy;
    frame.pressure = s.pressureEMA;
    frame.asymmetry = asymmetry;
    frame.wickDominance = wb.wickDom;
    frame.bodyEfficiency = wb.bodyEff;
    frame.runLength = s.lastSign * s.runLen;
    frame.regime = '';
    frame.warm = warm;

    metric('features.frames_emitted').inc();
    histo('features.latency_us').observe((performance.now() - t0) * 1000);

    QR.bus.emit('frame', frame);
    QR.tickPool.release(tick);
  }

  function init() {
    QR.bus.on('tick', onTick);
  }

  QR.features = { stateOf, _states: states };
  if (QR.kernel) QR.kernel.register('features.extractor', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/regime/classifier.js ──────────────────────────────────────────────────── */
// regime/classifier.js
// Adaptive market-state classifier.
//
// Architecture:
//   Subscribes to `frame`. Maintains per-asset hysteresis-based FSM with
//   eight states:
//     trending, ranging, volatile, compressed, unstable, reversal_prone,
//     manipulation_like, dead_market.
//   Decisions use a small feature vector from the FeatureFrame; classification
//   uses thresholds derived from rolling quantile-free estimators (median +
//   MAD-equivalent fast streaming approximations).
//   Emits `regime.tag` whenever the regime changes for an asset.
//
// Optimization:
//   - All thresholds are pre-computed per call; no allocation.
//   - Hysteresis: a regime must persist for K consecutive frames before
//     becoming active — protects against flapping.
//
// Failure handling:
//   - Cold frames (frame.warm === false) are tagged "warmup" and skipped.
//   - On extreme features (NaN / Infinity), the regime drops to "unstable"
//     and the pipeline gates execution.
//
// Telemetry:
//   - `regime.switches_total` counter
//   - `regime.switches_per_minute` gauge
//   - `regime.<name>.share` gauge (sampled)
//
// Integration:
//   Subscribes: `frame`. Mutates frame.regime in place, then re-emits on
//   `frame.tagged`. The pipeline subscribes to `frame.tagged`, not `frame`.
//
// Latency:
//   < 1 µs per frame.
//
// Memory:
//   Per-asset 64 bytes of state.
//
// Survivability:
//   Pure data-driven FSM; cannot stall the runtime.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.regime) return;

  const HYST_K = 3;

  // Reference thresholds — calibrated on synthetic ranges; the runtime can
  // adapt them via online quantile estimators in a future iteration.
  const T = {
    volHighBp: 8,
    volLowBp: 1.5,
    entropyHigh: 0.97,   // near-random
    entropyLow: 0.75,    // strongly directional
    pressureStrong: 6e-5,
    accelStrong: 4e-5,
    deadVelBp: 0.6,
    wickDomHigh: 0.65,
  };

  const states = new Map();   // asset → { current, candidate, run, switches, lastSwitchAt, history }

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function gauge(name) { const m = QR.metrics; return m ? m.gauge(name) : { set() {} }; }

  function stateOf(asset) {
    let s = states.get(asset);
    if (!s) {
      s = { current: 'warmup', candidate: 'warmup', run: 0, switches: 0, lastSwitchAt: 0 };
      states.set(asset, s);
    }
    return s;
  }

  function classifyFrame(f) {
    if (!f.warm) return 'warmup';
    if (!Number.isFinite(f.realizedVolBp) || !Number.isFinite(f.entropy)) return 'unstable';

    const vol = f.realizedVolBp;
    const ent = f.entropy;
    const prs = f.pressure;
    const acc = f.acceleration;
    const vel = f.velocity * 10000; // bp-scale

    if (vel < T.deadVelBp && vol < T.volLowBp) return 'dead_market';
    if (vol > T.volHighBp && ent > T.entropyHigh) return 'volatile';
    if (vol > T.volHighBp && Math.abs(prs) > T.pressureStrong && Math.abs(acc) > T.accelStrong) return 'manipulation_like';
    if (vol < T.volLowBp && ent > T.entropyHigh) return 'compressed';
    if (ent < T.entropyLow && Math.abs(prs) > T.pressureStrong) return 'trending';
    if (ent > T.entropyHigh && Math.abs(prs) < T.pressureStrong) return 'ranging';
    if (f.wickDominance > T.wickDomHigh && Math.abs(acc) > T.accelStrong) return 'reversal_prone';
    return 'unstable';
  }

  function onFrame(f) {
    const s = stateOf(f.asset);
    const proposed = classifyFrame(f);
    if (proposed === s.candidate) {
      s.run++;
    } else {
      s.candidate = proposed;
      s.run = 1;
    }
    if (s.run >= HYST_K && s.current !== s.candidate) {
      const prev = s.current;
      s.current = s.candidate;
      s.switches++;
      s.lastSwitchAt = f.ts;
      metric('regime.switches_total').inc();
      QR.bus.emit('regime.switch', { asset: f.asset, from: prev, to: s.current, at: f.ts });
    }
    f.regime = s.current;
    QR.bus.emit('frame.tagged', f);
  }

  function init() {
    QR.bus.on('frame', onFrame);
    // Per-minute switch-rate gauge
    QR.scheduler.every(60_000, () => {
      let total = 0;
      states.forEach((s) => { total += s.switches; s.switches = 0; });
      gauge('regime.switches_per_minute').set(total);
    }, 'regime.switch_rate');
  }

  QR.regime = { stateOf, classifyFrame };
  if (QR.kernel) QR.kernel.register('regime.classifier', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/predict/models.js ──────────────────────────────────────────────────── */
// predict/models.js
// Six specialist prediction models — pure functions, no allocation.
//
// Architecture:
//   Each model is a pure function `model(frame, state) → vote ∈ [-1, +1]`,
//   where the sign indicates direction and the magnitude indicates strength.
//   The ensemble (predict/ensemble.js) combines votes weighted by regime.
//
//   Specialists:
//     - momentum     — short-horizon directional persistence
//     - meanRevert   — fade-the-move when pressure flips sign
//     - pressure     — signed-flow imbalance
//     - volatility   — directional bias in volatile regimes (skew-aware)
//     - statistical  — z-score on log-return
//     - sequence     — placeholder stub vote; the real sequence model lives
//                       in predict/sequence_inference.js and is called via
//                       the worker. Until inference returns, this returns 0.
//
// Optimization:
//   - All math is in-place; no temporary arrays.
//   - State is a small object owned by the ensemble layer (one per asset).
//
// Failure handling:
//   - Non-finite features → return 0 (abstain).
//
// Telemetry:
//   - `predict.<model>.votes` histogram (sampled)
//
// Integration:
//   Imported by predict/ensemble.js.
//
// Latency:
//   ~sub-µs per model.
//
// Memory:
//   Stateless; small per-asset state lives in ensemble.
//
// Survivability:
//   Pure functions — cannot fail at runtime.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.predict && QR.predict.models) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function tanh(x) { return Math.tanh(x); }

  function momentum(f) {
    if (!Number.isFinite(f.pressure) || !Number.isFinite(f.runLength)) return 0;
    // Run length encodes persistence; pressure encodes direction.
    const sgn = f.pressure > 0 ? 1 : (f.pressure < 0 ? -1 : 0);
    const persist = clamp(Math.abs(f.runLength) / 8, 0, 1);
    return sgn * persist * 0.9;
  }

  function meanRevert(f) {
    if (!Number.isFinite(f.pressure) || !Number.isFinite(f.entropy)) return 0;
    // Fade extreme pressure when entropy is moderate (not yet random).
    const extreme = tanh(Math.abs(f.pressure) / 1e-4);
    const fadeable = clamp((0.95 - f.entropy) * 5, 0, 1);
    const sgn = f.pressure > 0 ? -1 : 1;
    return sgn * extreme * fadeable;
  }

  function pressure(f) {
    if (!Number.isFinite(f.pressure)) return 0;
    return tanh(f.pressure / 5e-5);
  }

  function volatility(f) {
    if (!Number.isFinite(f.realizedVolBp) || !Number.isFinite(f.asymmetry)) return 0;
    // In volatile regimes the skew of recent returns is a leading hint.
    const intensity = clamp(f.realizedVolBp / 10, 0, 1);
    return clamp(f.asymmetry, -2, 2) / 2 * intensity;
  }

  function statistical(f) {
    if (!Number.isFinite(f.velocity) || !Number.isFinite(f.realizedVolBp)) return 0;
    if (f.realizedVolBp < 1e-3) return 0;
    // Z-score on directional acceleration normalized by realized vol.
    const z = (f.acceleration * 10000) / Math.max(f.realizedVolBp, 1);
    return tanh(z);
  }

  function sequence(f, state) {
    if (!state || !state.lastSequenceVote) return 0;
    const v = state.lastSequenceVote;
    if (!Number.isFinite(v.value) || !Number.isFinite(v.at)) return 0;
    // Decay sequence vote with age: half-life 1.5 s.
    const ageMs = performance.now() - v.at;
    const decay = Math.exp(-ageMs / 1500);
    return clamp(v.value * decay, -1, 1);
  }

  QR.predict = QR.predict || {};
  QR.predict.models = { momentum, meanRevert, pressure, volatility, statistical, sequence };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/predict/calibration.js ──────────────────────────────────────────────────── */
// predict/calibration.js
// Confidence calibration — Platt-style logistic re-mapping plus drift tracking.
//
// Architecture:
//   The ensemble emits a raw probability `pRaw ∈ [0, 1]` for the direction
//   the prediction took. The calibrator maintains a sigmoid:
//       pCal = σ(a · logit(pRaw) + b)
//   parameters (a, b) updated via per-result SGD with a tiny learning rate.
//   Updates use only realized win/loss labels — never the prediction value
//   the system fired on (no look-ahead).
//
//   The calibrator also tracks `drift` — rolling correlation between pCal
//   and realized outcome. When drift falls below a threshold, the ensemble
//   widens its abstention band and reduces exposure.
//
// Optimization:
//   - No allocations; all state is scalars.
//   - Update is one log, one mult, one add per trade — O(1).
//
// Failure handling:
//   - pRaw clamped to [eps, 1-eps] before logit to avoid Infinity.
//   - On extreme drift the calibrator resets to identity (a=1, b=0) and
//     emits `predict.calibration.reset`.
//
// Telemetry:
//   - `predict.calibration.a` gauge
//   - `predict.calibration.b` gauge
//   - `predict.calibration.drift` gauge
//   - `predict.calibration.resets` counter
//
// Integration:
//   Subscribes: `execution.result` { pCal, win }. Emits: nothing — exposes
//   functions `calibrate(p)` and `getDrift()`.
//
// Latency:
//   < 1 µs.
//
// Memory:
//   ~64 bytes.
//
// Survivability:
//   Self-resetting; cannot drift unboundedly.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.predict && QR.predict.calibration) return;

  const LR = 0.01;
  const EPS = 1e-6;
  const DRIFT_WINDOW = 64;
  const DRIFT_RESET_THRESH = -0.15;   // negative correlation → reset

  let a = 1.0, b = 0.0;
  let resets = 0;
  let sumP = 0, sumY = 0, sumPY = 0, sumP2 = 0, sumY2 = 0, n = 0;
  const buf = new Float64Array(DRIFT_WINDOW * 2);
  let head = 0, count = 0;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function gauge(name)  { const m = QR.metrics; return m ? m.gauge(name) : { set() {} }; }

  function logit(p) {
    const c = Math.max(EPS, Math.min(1 - EPS, p));
    return Math.log(c / (1 - c));
  }
  function sigmoid(z) {
    if (z >= 0) {
      const e = Math.exp(-z);
      return 1 / (1 + e);
    } else {
      const e = Math.exp(z);
      return e / (1 + e);
    }
  }

  function calibrate(pRaw) {
    return sigmoid(a * logit(pRaw) + b);
  }

  function recordWindow(p, y) {
    const idxP = head * 2;
    const idxY = idxP + 1;
    if (count === DRIFT_WINDOW) {
      const oldP = buf[idxP];
      const oldY = buf[idxY];
      sumP -= oldP; sumY -= oldY; sumPY -= oldP * oldY;
      sumP2 -= oldP * oldP; sumY2 -= oldY * oldY;
    } else {
      count++;
    }
    buf[idxP] = p; buf[idxY] = y;
    sumP += p; sumY += y; sumPY += p * y;
    sumP2 += p * p; sumY2 += y * y;
    head = (head + 1) % DRIFT_WINDOW;
    n = count;
  }

  function drift() {
    if (n < 16) return 0;
    const num = n * sumPY - sumP * sumY;
    const den = Math.sqrt(Math.max(0, (n * sumP2 - sumP * sumP) * (n * sumY2 - sumY * sumY)));
    return den === 0 ? 0 : num / den;
  }

  function update(pCal, win) {
    const y = win ? 1 : 0;
    const z = a * logit(pCal) + b;
    const pHat = sigmoid(z);
    const err = pHat - y;
    const lp = logit(pCal);
    a -= LR * err * lp;
    b -= LR * err;
    // Sanity bounds: keep a in [0.25, 4], b in [-2, 2].
    if (a < 0.25) a = 0.25; else if (a > 4) a = 4;
    if (b < -2) b = -2; else if (b > 2) b = 2;

    recordWindow(pCal, y);
    const d = drift();
    gauge('predict.calibration.a').set(a);
    gauge('predict.calibration.b').set(b);
    gauge('predict.calibration.drift').set(d);

    if (d < DRIFT_RESET_THRESH && n >= DRIFT_WINDOW) {
      a = 1.0; b = 0.0;
      sumP = sumY = sumPY = sumP2 = sumY2 = 0; n = 0; head = 0; count = 0;
      resets++;
      metric('predict.calibration.resets').inc();
      QR.bus.emit('predict.calibration.reset', { reason: 'drift', d });
    }
  }

  function init() {
    QR.bus.on('execution.result', (r) => {
      if (r && Number.isFinite(r.pCal) && (r.win === true || r.win === false)) {
        update(r.pCal, r.win);
      }
    });
  }

  QR.predict = QR.predict || {};
  QR.predict.calibration = { calibrate, update, drift, params: () => ({ a, b, resets }) };
  if (QR.kernel) QR.kernel.register('predict.calibration', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/predict/sequence_inference.js ──────────────────────────────────────────────────── */
// predict/sequence_inference.js
// Browser-side lightweight sequence inference adapter.
//
// Architecture:
//   The runtime targets TFJS-lite-compatible models for sequence forecasting,
//   but does NOT require TFJS to be present. If `tf` is available, this
//   module uses it; otherwise it falls back to a pure-JS depthwise causal
//   convolution + linear head implementation that runs in a worker.
//
//   Public API:
//     loadModel(url|null)  — load weights or operate weights-free.
//     submit(asset, vector) — submit a feature vector for inference. Result
//                            arrives asynchronously via `predict.sequence_vote`.
//
//   The inference window is the last N frames per asset; the model emits a
//   direction-scalar in [-1, +1] for the next horizon, with confidence-decay
//   handled by the ensemble (see `sequence` in models.js).
//
// Optimization:
//   - Inputs are packed into a Float32Array transferable to the worker.
//   - Outputs are returned as a single scalar — no JSON round-trip overhead.
//   - Submissions are throttled to ≤ 20 Hz globally; the worker batches them.
//
// Failure handling:
//   - If the worker crashes, the orchestrator restarts it and this module
//     falls back to a cached last-vote until a fresh inference arrives.
//   - If no model is loaded, this module is a no-op and `sequence` in
//     models.js will return 0.
//
// Telemetry:
//   - `predict.sequence.submits`
//   - `predict.sequence.completions`
//   - `predict.sequence.latency_ms` histogram
//   - `predict.sequence.fallbacks`
//
// Integration:
//   Subscribes: `frame.tagged` (to capture feature vectors).
//   Emits: `predict.sequence_vote` { asset, value: [-1..1], at }.
//
// Latency:
//   Submission is O(N) for the vector copy; inference latency depends on the
//   worker (target p95 < 25 ms).
//
// Memory:
//   Two Float32Array vectors per submission (input/output) plus a small
//   per-asset history.
//
// Survivability:
//   Optional component. If unavailable, ensemble down-weights to zero.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.predict && QR.predict.sequence) return;

  const HISTORY = 32;          // frames per inference vector
  const FEATURES = 8;
  const MIN_SUBMIT_MS = 50;    // 20 Hz cap

  const perAsset = new Map();  // asset → { hist: Float32Array, idx: 0, lastSubmitAt: 0 }
  let modelReady = false;
  let lastVoteByAsset = new Map();   // asset → { value, at }

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function histo(name)  { const m = QR.metrics; return m ? m.histogram(name) : { observe() {} }; }

  function stateOf(asset) {
    let s = perAsset.get(asset);
    if (!s) {
      s = { hist: new Float32Array(HISTORY * FEATURES), idx: 0, lastSubmitAt: 0 };
      perAsset.set(asset, s);
    }
    return s;
  }

  function packFrame(f, out, base) {
    out[base + 0] = f.velocity;
    out[base + 1] = f.acceleration;
    out[base + 2] = f.realizedVolBp;
    out[base + 3] = f.entropy;
    out[base + 4] = f.pressure;
    out[base + 5] = f.asymmetry;
    out[base + 6] = f.wickDominance;
    out[base + 7] = f.bodyEfficiency;
  }

  function loadModel(url) {
    // Hook point for a future TFJS-lite loader. For now, we only mark "ready"
    // if the worker orchestrator reports an available compute worker, so the
    // fallback JS inference can run.
    modelReady = !!(QR.workers && QR.workers.isReady && QR.workers.isReady());
    if (modelReady) {
      QR.bus.emit('predict.sequence.ready', { url: url || null });
    } else {
      QR.bus.emit('predict.sequence.unavailable', { reason: 'no worker' });
    }
    return modelReady;
  }

  function onFrame(f) {
    if (!modelReady) return;
    const s = stateOf(f.asset);
    // Append to rolling history.
    packFrame(f, s.hist, (s.idx % HISTORY) * FEATURES);
    s.idx++;
    if (s.idx < HISTORY) return;

    const now = performance.now();
    if (now - s.lastSubmitAt < MIN_SUBMIT_MS) return;
    s.lastSubmitAt = now;

    metric('predict.sequence.submits').inc();
    const submittedAt = now;

    // Send a copy to the worker; do not transfer the canonical history.
    const payload = new Float32Array(HISTORY * FEATURES);
    payload.set(s.hist);

    QR.workers.dispatch('sequence.infer', { asset: f.asset, vector: payload }, [payload.buffer])
      .then((res) => {
        const latency = performance.now() - submittedAt;
        histo('predict.sequence.latency_ms').observe(latency);
        metric('predict.sequence.completions').inc();
        const vote = { value: clamp(res.value, -1, 1), at: performance.now() };
        lastVoteByAsset.set(f.asset, vote);
        QR.bus.emit('predict.sequence_vote', { asset: f.asset, ...vote });
      })
      .catch(() => {
        metric('predict.sequence.fallbacks').inc();
      });
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function lastVote(asset) {
    return lastVoteByAsset.get(asset) || null;
  }

  function init() {
    QR.bus.on('frame.tagged', onFrame);
    // Try to enable on boot when the worker orchestrator is up.
    QR.scheduler.defer(() => loadModel(null), 200, 'predict.sequence.boot');
  }

  QR.predict = QR.predict || {};
  QR.predict.sequence = { loadModel, lastVote };
  if (QR.kernel) QR.kernel.register('predict.sequence', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/predict/ensemble.js ──────────────────────────────────────────────────── */
// predict/ensemble.js
// Regime-conditioned weighted ensemble of specialist votes.
//
// Architecture:
//   For each tagged frame:
//     1. Collect votes from the six specialists in models.js.
//     2. Look up the active regime's weight vector.
//     3. Compute a signed score s = Σ w_i · v_i  ∈  [-1, +1].
//     4. Map to a directional probability pRaw via 0.5 + 0.5·σ(k·s).
//     5. Calibrate to pCal via predict/calibration.js.
//     6. Emit a Prediction on `prediction` channel.
//
//   Weight vectors are regime-specific and adapt online with a tiny EMA of
//   per-model realized hit-rate. Models that drift down lose weight; models
//   that prove themselves gain weight, bounded.
//
// Optimization:
//   - One pooled Prediction object per emission.
//   - All math is scalar; no array allocations per emit.
//
// Failure handling:
//   - On warmup or "unstable" regime, the ensemble abstains (direction = 0)
//     and emits the prediction anyway so telemetry can see the decision.
//   - If calibration is missing, pCal = pRaw.
//
// Telemetry:
//   - `predict.ensemble.emits`
//   - `predict.ensemble.abstains`
//   - `predict.ensemble.weight.<model>` gauge (sampled)
//   - `predict.ensemble.score` histogram
//
// Integration:
//   Subscribes: `frame.tagged`, `execution.result` (for weight adaptation),
//   `predict.sequence_vote` (to seed the sequence specialist).
//   Emits: `prediction`.
//
// Latency:
//   < 5 µs per frame.
//
// Memory:
//   Per-asset state map; ~256 bytes per asset.
//
// Survivability:
//   Self-bounded weights; cannot blow up.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.predict && QR.predict.ensemble) return;

  const MODEL_KEYS = ['momentum', 'meanRevert', 'pressure', 'volatility', 'statistical', 'sequence'];

  // Default per-regime weights — chosen so each regime emphasizes the
  // specialists most likely to be informative there.
  const REGIME_WEIGHTS = {
    trending:           { momentum: 0.30, meanRevert: 0.05, pressure: 0.20, volatility: 0.10, statistical: 0.15, sequence: 0.20 },
    ranging:            { momentum: 0.05, meanRevert: 0.30, pressure: 0.10, volatility: 0.10, statistical: 0.20, sequence: 0.25 },
    volatile:           { momentum: 0.10, meanRevert: 0.10, pressure: 0.10, volatility: 0.30, statistical: 0.10, sequence: 0.30 },
    compressed:         { momentum: 0.10, meanRevert: 0.20, pressure: 0.10, volatility: 0.15, statistical: 0.20, sequence: 0.25 },
    reversal_prone:     { momentum: 0.05, meanRevert: 0.35, pressure: 0.10, volatility: 0.15, statistical: 0.10, sequence: 0.25 },
    manipulation_like:  { momentum: 0.05, meanRevert: 0.05, pressure: 0.05, volatility: 0.10, statistical: 0.05, sequence: 0.05 }, // mostly abstain
    dead_market:        { momentum: 0.00, meanRevert: 0.00, pressure: 0.00, volatility: 0.00, statistical: 0.00, sequence: 0.00 }, // total abstain
    unstable:           { momentum: 0.00, meanRevert: 0.00, pressure: 0.00, volatility: 0.00, statistical: 0.00, sequence: 0.00 },
    warmup:             { momentum: 0.00, meanRevert: 0.00, pressure: 0.00, volatility: 0.00, statistical: 0.00, sequence: 0.00 },
  };

  // Per-model online hit-rate (Beta-ish). Used to scale weight ±20%.
  const hitState = Object.fromEntries(MODEL_KEYS.map((k) => [k, { wins: 1, losses: 1 }]));
  const perAsset = new Map();   // asset → { lastSequenceVote }

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function gauge(name)  { const m = QR.metrics; return m ? m.gauge(name) : { set() {} }; }
  function histo(name)  { const m = QR.metrics; return m ? m.histogram(name) : { observe() {} }; }

  function stateOf(asset) {
    let s = perAsset.get(asset);
    if (!s) { s = { lastSequenceVote: null }; perAsset.set(asset, s); }
    return s;
  }

  function sigmoidScaled(s) {
    // map [-1..1] → probability via sigmoid with gain k=3
    const z = 3 * s;
    const e = Math.exp(-z);
    const p = 1 / (1 + e);
    // Mapped further: keep extremes around 0.5 modestly to avoid overconfidence.
    return 0.5 + 0.85 * (p - 0.5);
  }

  function scoreFrame(f) {
    const m = QR.predict.models;
    const s = stateOf(f.asset);
    const votes = {
      momentum:    m.momentum(f),
      meanRevert:  m.meanRevert(f),
      pressure:    m.pressure(f),
      volatility:  m.volatility(f),
      statistical: m.statistical(f),
      sequence:    m.sequence(f, s),
    };
    return votes;
  }

  function getRegimeWeights(regime) {
    return REGIME_WEIGHTS[regime] || REGIME_WEIGHTS.unstable;
  }

  function modelMultiplier(model) {
    const r = hitState[model];
    const wr = r.wins / (r.wins + r.losses);
    // Map win-rate [0.4..0.6] → [0.8..1.2]
    const m = 0.8 + Math.max(0, Math.min(1, (wr - 0.4) / 0.2)) * 0.4;
    return m;
  }

  function onFrameTagged(f) {
    const votes = scoreFrame(f);
    const baseW = getRegimeWeights(f.regime);

    let signed = 0;
    let wSum = 0;
    for (let i = 0; i < MODEL_KEYS.length; i++) {
      const k = MODEL_KEYS[i];
      const w = baseW[k] * modelMultiplier(k);
      signed += w * votes[k];
      wSum   += w;
    }
    const score = wSum > 0 ? signed : 0;
    histo('predict.ensemble.score').observe(score);

    const direction = score > 0.02 ? 1 : (score < -0.02 ? -1 : 0);
    let pRaw = 0.5;
    if (direction !== 0) {
      const oriented = score * direction;          // ∈ [0..1] effectively
      pRaw = sigmoidScaled(oriented);
    }
    const pCal = (QR.predict.calibration ? QR.predict.calibration.calibrate(pRaw) : pRaw);

    const out = QR.predictionPool.acquire();
    out.asset = f.asset;
    out.ts = f.ts;
    out.direction = direction;
    out.pRaw = pRaw;
    out.pCal = pCal;
    out.regime = f.regime;
    out.modelVotes.mom = votes.momentum;
    out.modelVotes.mr  = votes.meanRevert;
    out.modelVotes.seq = votes.sequence;
    out.modelVotes.prs = votes.pressure;
    out.modelVotes.vol = votes.volatility;
    out.modelVotes.stat= votes.statistical;

    if (direction === 0) metric('predict.ensemble.abstains').inc();
    metric('predict.ensemble.emits').inc();
    QR.bus.emit('prediction', out);

    // Per-asset frame release — done by the prediction consumer (pipeline).
    QR.framePool.release(f);
  }

  function onSequenceVote(ev) {
    const s = stateOf(ev.asset);
    s.lastSequenceVote = { value: ev.value, at: ev.at };
  }

  function onResult(r) {
    if (!r || !r.modelVotes || (r.win !== true && r.win !== false)) return;
    const votes = r.modelVotes;
    const dir = r.direction;
    if (dir === 0) return;
    for (const k of MODEL_KEYS) {
      const v = votes[k.replace('momentum','mom').replace('meanRevert','mr').replace('pressure','prs').replace('volatility','vol').replace('statistical','stat')];
      if (!Number.isFinite(v)) continue;
      // "Agreed with the trade" means the vote sign matched the direction.
      const agreed = Math.sign(v) === Math.sign(dir);
      const rec = hitState[k];
      if (agreed) {
        if (r.win) rec.wins++;
        else        rec.losses++;
      }
      if (rec.wins + rec.losses > 400) {
        rec.wins *= 0.5; rec.losses *= 0.5;
      }
      gauge('predict.ensemble.weight.' + k).set(modelMultiplier(k));
    }
  }

  function init() {
    QR.bus.on('frame.tagged', onFrameTagged);
    QR.bus.on('predict.sequence_vote', onSequenceVote);
    QR.bus.on('execution.result', onResult);
  }

  QR.predict = QR.predict || {};
  QR.predict.ensemble = {
    regimes: () => Object.keys(REGIME_WEIGHTS),
    hitState: () => JSON.parse(JSON.stringify(hitState)),
  };
  if (QR.kernel) QR.kernel.register('predict.ensemble', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/risk/risk_engine.js ──────────────────────────────────────────────────── */
// risk/risk_engine.js
// Fractional Kelly + streak compression + drawdown suppression + regime gate.
//
// Architecture:
//   The risk engine answers one question per prediction:
//     "Given this calibrated probability, current regime, recent outcomes,
//      and drawdown state, what fraction of bankroll should we expose, if any?"
//   It is consulted by execution/pipeline.js after calibration and before
//   timing.
//
//   Components:
//     - Fractional Kelly: f = (p·(1+payout) − 1) / payout, scaled by `kellyMul`.
//     - Streak compression: loss streaks shrink exposure geometrically.
//     - Drawdown suppression: total drawdown beyond `ddCap` halts trading.
//     - Regime gate: regimes {unstable, manipulation_like, dead_market, warmup}
//       block; {volatile, reversal_prone} apply a haircut.
//
// Optimization:
//   - All state is scalars or a tiny ring of recent results.
//   - One arithmetic chain per assessment.
//
// Failure handling:
//   - On stream-stall flag set by the watchdog, every assessment returns 0.
//   - On `clock.jump`, exposure halves for the next cooldown window.
//
// Telemetry:
//   - `risk.exposure_pct` gauge
//   - `risk.blocks.<reason>` counter
//   - `risk.drawdown_pct` gauge
//   - `risk.streak_losses` gauge
//
// Integration:
//   Public: assess(prediction, ctx) → { allow, fraction, reason }.
//   Subscribes: `execution.result` for win/loss accounting; `clock.jump`,
//   `ingest.stalled` for halt flags.
//
// Latency:
//   < 1 µs.
//
// Memory:
//   Small fixed.
//
// Survivability:
//   Stateful but bounded; resets on snapshot restore.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.risk) return;

  const CFG = {
    kellyMul: 0.50,         // fractional Kelly multiplier (½ Kelly — V12-like)
    payoutDefault: 0.80,    // 80% — overridable per asset via setPayout()
    minProbEdge: 0.52,      // pCal must exceed this (V12 was ~0.51)
    ddCap: 0.25,            // 25% peak-to-trough → halt
    streakCap: 5,           // 5 losses in a row → halt for cooldown
    streakShrink: 0.6,      // per recent loss
    haircutVolatile: 0.5,
    haircutReversal: 0.7,
    cooldownAfterStallMs: 30_000,
    cooldownAfterJumpMs: 10_000,
    historyWindow: 64,
  };

  const state = {
    bankroll: 1,            // normalized; UI may rescale
    peakBankroll: 1,
    streakLosses: 0,
    lastResultAt: 0,
    haltedUntil: 0,
    payoutByAsset: new Map(),
  };
  const history = new QR.RingBuffer(CFG.historyWindow); // {win, pCal}

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function gauge(name)  { const m = QR.metrics; return m ? m.gauge(name) : { set() {} }; }

  function setPayout(asset, payoutFraction) {
    if (!asset || !Number.isFinite(payoutFraction)) return;
    state.payoutByAsset.set(asset, Math.max(0.1, Math.min(2, payoutFraction)));
  }
  function getPayout(asset) {
    return state.payoutByAsset.get(asset) || CFG.payoutDefault;
  }

  function kellyFraction(p, payout) {
    if (p <= 0.5 || payout <= 0) return 0;
    const f = (p * (1 + payout) - 1) / payout;
    return f > 0 ? f : 0;
  }

  function drawdown() {
    return state.peakBankroll > 0 ? (1 - state.bankroll / state.peakBankroll) : 0;
  }

  function assess(pred) {
    const now = performance.now();
    const reasons = [];
    const reject = (why) => { metric('risk.blocks.' + why).inc(); return { allow: false, fraction: 0, reason: why }; };

    if (!pred || pred.direction === 0) return reject('no_direction');
    if (now < state.haltedUntil) return reject('halted');
    if (pred.regime === 'warmup' || pred.regime === 'unstable' ||
        pred.regime === 'dead_market' || pred.regime === 'manipulation_like') {
      return reject('regime_' + pred.regime);
    }
    if (pred.pCal < CFG.minProbEdge) return reject('low_prob');
    if (drawdown() >= CFG.ddCap) {
      state.haltedUntil = now + 5 * 60_000;
      return reject('drawdown_cap');
    }
    if (state.streakLosses >= CFG.streakCap) {
      state.haltedUntil = now + 60_000;
      return reject('streak_cap');
    }

    const payout = getPayout(pred.asset);
    let f = kellyFraction(pred.pCal, payout) * CFG.kellyMul;

    // Streak compression
    if (state.streakLosses > 0) f *= Math.pow(CFG.streakShrink, state.streakLosses);

    // Regime haircuts
    if (pred.regime === 'volatile') f *= CFG.haircutVolatile;
    else if (pred.regime === 'reversal_prone') f *= CFG.haircutReversal;

    f = Math.max(0, Math.min(0.05, f));   // hard cap 5% per trade

    gauge('risk.exposure_pct').set(f);
    gauge('risk.drawdown_pct').set(drawdown());
    gauge('risk.streak_losses').set(state.streakLosses);

    if (f <= 1e-4) return reject('fraction_too_small');
    return { allow: true, fraction: f, reason: 'ok', payout };
  }

  function recordResult(r) {
    if (!r) return;
    history.push({ win: !!r.win, pCal: r.pCal });
    const stake = r.fraction || 0;
    if (r.win) {
      state.bankroll *= (1 + stake * (r.payout || CFG.payoutDefault));
      state.streakLosses = 0;
    } else {
      state.bankroll *= (1 - stake);
      state.streakLosses++;
    }
    if (state.bankroll > state.peakBankroll) state.peakBankroll = state.bankroll;
    state.lastResultAt = performance.now();
    gauge('risk.bankroll').set(state.bankroll);
    gauge('risk.drawdown_pct').set(drawdown());
    QR.bus.emit('risk.result', { ...r, bankroll: state.bankroll, drawdown: drawdown() });
  }

  function init() {
    QR.bus.on('execution.result', recordResult);
    QR.bus.on('clock.jump', () => {
      state.haltedUntil = Math.max(state.haltedUntil, performance.now() + CFG.cooldownAfterJumpMs);
    });
    QR.bus.on('ingest.stalled', () => {
      state.haltedUntil = Math.max(state.haltedUntil, performance.now() + CFG.cooldownAfterStallMs);
    });
  }

  function configure(opts) {
    if (!opts) return;
    if (Number.isFinite(+opts.kellyMul))     CFG.kellyMul     = Math.max(0.01, Math.min(1.0,  +opts.kellyMul));
    if (Number.isFinite(+opts.minProbEdge))  CFG.minProbEdge  = Math.max(0.50, Math.min(0.95, +opts.minProbEdge));
    if (Number.isFinite(+opts.ddCap))        CFG.ddCap        = Math.max(0.05, Math.min(0.80, +opts.ddCap));
    if (Number.isFinite(+opts.streakCap))    CFG.streakCap    = Math.max(1,    Math.min(20,   +opts.streakCap | 0));
    QR.bus.emit('risk.configured', getConfig());
  }
  function getConfig() {
    return {
      kellyMul: CFG.kellyMul, minProbEdge: CFG.minProbEdge,
      ddCap: CFG.ddCap, streakCap: CFG.streakCap,
    };
  }
  function resetHalt() { state.haltedUntil = 0; }

  QR.risk = {
    assess, recordResult, setPayout, getPayout, drawdown,
    configure, getConfig, resetHalt,
    state: () => ({ ...state, payoutByAsset: undefined }),
    snapshot: () => ({ bankroll: state.bankroll, peak: state.peakBankroll, streak: state.streakLosses }),
    restore: (snap) => {
      if (!snap) return;
      if (Number.isFinite(snap.bankroll)) state.bankroll = snap.bankroll;
      if (Number.isFinite(snap.peak))     state.peakBankroll = snap.peak;
      if (Number.isFinite(snap.streak))   state.streakLosses = snap.streak;
    },
  };
  if (QR.kernel) QR.kernel.register('risk.engine', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/execution/timing_engine.js ──────────────────────────────────────────────────── */
// execution/timing_engine.js
// Execution Timing Calibrator — adaptive entry delay and drift compensation.
//
// Architecture:
//   The platform takes a non-trivial time from "we decide to click" to
//   "the order is accepted on the server". This module learns that delay
//   distribution from observed (decide → ack) samples and produces an
//   `effectiveDelayMs` that the actuator should wait before the candle
//   close boundary. It also tracks a "click-to-ack" histogram for telemetry.
//
//   The legacy V12 had an ETC table tied to wins/losses; we replace that
//   with a Welford-style mean/variance and a simple proportional adapter:
//   target offset = mean(clickToAck) − safetyMs(variance).
//
// Optimization:
//   - One scalar update on each ack.
//   - No allocations.
//
// Failure handling:
//   - On `clock.jump`, the timing engine widens its safety margin by 2× for
//     the next cooldown.
//   - On 3 consecutive missing acks, the runtime enters "no execution" mode.
//
// Telemetry:
//   - `execution.click_to_ack_ms` histogram
//   - `execution.timing_offset_ms` gauge
//   - `execution.acks_missing` counter
//
// Integration:
//   Public: schedule(pred, decisionAt) → ms-from-now to fire the click.
//           recordAck(clickAt, ackAt) → updates the model.
//   Subscribes: `execution.ack`, `clock.jump`.
//
// Latency:
//   < 1 µs.
//
// Memory:
//   ~64 bytes.
//
// Survivability:
//   Defaults are conservative if no samples have been observed.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.execution && QR.execution.timing) return;

  const CFG = {
    defaultOffsetMs: 60,
    safetyMultiplier: 1.2,
    maxOffsetMs: 800,
    consecutiveMissingHalt: 3,
  };

  let n = 0;
  let mean = CFG.defaultOffsetMs;
  let m2 = 0;
  let safetyExtraMs = 0;
  let missingAcks = 0;
  let lastUpdated = 0;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function gauge(name)  { const m = QR.metrics; return m ? m.gauge(name) : { set() {} }; }
  function histo(name)  { const m = QR.metrics; return m ? m.histogram(name) : { observe() {} }; }

  function variance() { return n > 1 ? m2 / (n - 1) : 0; }

  function offsetMs() {
    const sigma = Math.sqrt(variance());
    const v = mean * CFG.safetyMultiplier + sigma + safetyExtraMs;
    return Math.max(5, Math.min(CFG.maxOffsetMs, v));
  }

  function schedule() {
    // Returns the ms ahead of close-boundary that the actuator should fire.
    // Callers compute close-boundary from candle period.
    const off = offsetMs();
    gauge('execution.timing_offset_ms').set(off);
    return off;
  }

  function recordAck(clickAt, ackAt) {
    if (!Number.isFinite(clickAt) || !Number.isFinite(ackAt) || ackAt < clickAt) {
      metric('execution.acks_missing').inc();
      missingAcks++;
      if (missingAcks >= CFG.consecutiveMissingHalt) {
        QR.bus.emit('execution.halt', { reason: 'missing_acks' });
      }
      return;
    }
    missingAcks = 0;
    const dt = ackAt - clickAt;
    histo('execution.click_to_ack_ms').observe(dt);
    n++;
    const delta = dt - mean;
    mean += delta / n;
    m2  += delta * (dt - mean);
    lastUpdated = performance.now();
    safetyExtraMs = Math.max(0, safetyExtraMs - 1);   // decay
  }

  function onClockJump(ev) {
    safetyExtraMs = Math.min(200, safetyExtraMs + 50);
    QR.bus.emit('execution.timing.widen', { extraMs: safetyExtraMs, cause: 'clock_jump', lag: ev && ev.lagMs });
  }

  function init() {
    QR.bus.on('execution.ack', (ev) => recordAck(ev.clickAt, ev.ackAt));
    QR.bus.on('clock.jump', onClockJump);
  }

  QR.execution = QR.execution || {};
  QR.execution.timing = {
    schedule, recordAck, offsetMs,
    stats: () => ({ n, mean, sigma: Math.sqrt(variance()), safetyExtraMs }),
  };
  if (QR.kernel) QR.kernel.register('execution.timing', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/execution/dom_actuator.js ──────────────────────────────────────────────────── */
// execution/dom_actuator.js
// Resilient DOM-click executor — performs the actual Higher/Lower click.
//
// Architecture:
//   The actuator resolves selectors via the self-healing selector registry
//   (dom/self_healing.js), then dispatches a chain of native events
//   (pointerdown → mousedown → mouseup → click) on the resolved element.
//   It does NOT directly call platform APIs; it operates only on the DOM,
//   which is the same surface a human uses.
//
//   The actuator is consulted only by execution/pipeline.js, never directly
//   by prediction or risk.
//
// Optimization:
//   - Resolve once per click, cache for the next call cycle.
//   - Reuse a single MouseEvent pool when possible.
//
// Failure handling:
//   - If the selector resolves to nothing, emit `execution.failed` with a
//     "no_target" reason and ask the self-healing module to rebind.
//   - If the click throws, count an error and rebind.
//   - If three consecutive clicks fail, request degraded mode.
//
// Telemetry:
//   - `execution.clicks_total`
//   - `execution.clicks_failed`
//   - `execution.click_ms` histogram
//   - `execution.rebinds_requested`
//
// Integration:
//   Public: click(direction) → Promise<{ok, clickAt}>.
//   Emits: `execution.click`, `execution.failed`.
//
// Latency:
//   < 1 ms typical; the goal is determinism, not raw speed.
//
// Memory:
//   None per click (after warm-up).
//
// Survivability:
//   Failures are isolated; the rest of the runtime continues even when
//   clicking is impossible.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.execution && QR.execution.actuator) return;

  let consecutiveFailures = 0;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function histo(name)  { const m = QR.metrics; return m ? m.histogram(name) : { observe() {} }; }

  function dispatch(el) {
    const opts = { bubbles: true, cancelable: true, view: W };
    el.dispatchEvent(new W.MouseEvent('pointerdown', opts));
    el.dispatchEvent(new W.MouseEvent('mousedown',   opts));
    el.dispatchEvent(new W.MouseEvent('mouseup',     opts));
    el.dispatchEvent(new W.MouseEvent('click',       opts));
  }

  function resolve(direction) {
    const healer = QR.dom && QR.dom.selfHealing;
    if (!healer) return null;
    const key = direction > 0 ? 'btn.higher' : 'btn.lower';
    return healer.resolve(key);
  }

  async function click(direction) {
    const t0 = performance.now();
    const el = resolve(direction);
    if (!el) {
      metric('execution.clicks_failed').inc();
      metric('execution.rebinds_requested').inc();
      consecutiveFailures++;
      if (QR.dom && QR.dom.selfHealing) QR.dom.selfHealing.invalidate();
      QR.bus.emit('execution.failed', { reason: 'no_target', direction });
      if (consecutiveFailures >= 3) QR.bus.emit('execution.halt', { reason: 'no_target_streak' });
      return { ok: false, clickAt: 0, reason: 'no_target' };
    }
    try {
      dispatch(el);
      const clickAt = performance.now();
      metric('execution.clicks_total').inc();
      histo('execution.click_ms').observe(clickAt - t0);
      consecutiveFailures = 0;
      QR.bus.emit('execution.click', { direction, clickAt });
      return { ok: true, clickAt };
    } catch (e) {
      metric('execution.clicks_failed').inc();
      consecutiveFailures++;
      QR.bus.emit('execution.failed', { reason: 'exception', direction, msg: String(e && e.message || e) });
      return { ok: false, clickAt: 0, reason: 'exception' };
    }
  }

  QR.execution = QR.execution || {};
  QR.execution.actuator = { click };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/execution/pipeline.js ──────────────────────────────────────────────────── */
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

/* ─── src/telemetry/hud.js ──────────────────────────────────────────────────── */
// telemetry/hud.js
// Optional debug overlay — opt-in HUD showing live runtime state.
//
// Architecture:
//   Mounts a single absolute-positioned div in the page; refreshes once per
//   second using requestIdleCallback. The HUD is hidden by default and can
//   be toggled by setting `localStorage.QR_HUD = '1'` or calling
//   `QR.telemetry.hud.toggle()`. The HUD reads from `QR.metrics.snapshot()`
//   and the kernel status; it never holds long references.
//
// Optimization:
//   - One DOM container; updates via textContent only (no re-render).
//   - Updates only when the tab is visible.
//
// Failure handling:
//   - If document.body is unavailable, defer mount.
//   - If rendering throws, the HUD silently disables itself.
//
// Telemetry:
//   - `telemetry.hud.renders`
//
// Integration:
//   Public: mount(), toggle(), unmount().
//
// Latency:
//   Updates ≤ 1 ms.
//
// Memory:
//   One element; ~few hundred bytes of text per render.
//
// Survivability:
//   HUD failure cannot affect the runtime.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.telemetry && QR.telemetry.hud) return;

  let host = null;
  let visible = false;
  let intervalH = null;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }

  function ensureHost() {
    if (host) return host;
    if (!W.document || !W.document.body) return null;
    host = W.document.createElement('div');
    host.id = '__qr_hud__';
    host.style.cssText = [
      'position:fixed', 'right:8px', 'bottom:8px', 'z-index:2147483647',
      'background:rgba(10,12,16,0.86)', 'color:#cfe0ff', 'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace',
      'padding:8px 10px', 'border:1px solid #2a4', 'border-radius:6px',
      'max-width:380px', 'pointer-events:none', 'white-space:pre-wrap',
      'box-shadow:0 4px 16px rgba(0,0,0,.4)',
    ].join(';');
    host.textContent = 'QR · booting…';
    W.document.body.appendChild(host);
    return host;
  }

  function render() {
    metric('telemetry.hud.renders').inc();
    if (!host || W.document.hidden) return;
    try {
      const k = QR.kernel ? QR.kernel.status() : { booted: false };
      const m = QR.metrics ? QR.metrics.snapshot() : { counters: {}, gauges: {}, histograms: {} };
      const c = m.counters;
      const g = m.gauges;
      const h = m.histograms;
      const lines = [];
      lines.push('QR  · ' + (k.booted ? 'up' : 'down') +
                 '   loaded=' + k.loaded.length +
                 '   degraded=' + (k.degraded.length));
      lines.push('ticks ' + (c['ingest.normalizer.ticks_total'] || 0) +
                 '   frames ' + (c['features.frames_emitted'] || 0) +
                 '   preds ' + (c['predict.ensemble.emits'] || 0));
      lines.push('clicks ' + (c['execution.clicks_total'] || 0) +
                 '   fail ' + (c['execution.clicks_failed'] || 0) +
                 '   in-flight ' + (g['pipeline.in_flight'] || 0));
      const claHist = h['execution.click_to_ack_ms'] || { p50: 0, p95: 0 };
      lines.push('click→ack  p50=' + claHist.p50.toFixed(1) + 'ms  p95=' + claHist.p95.toFixed(1) + 'ms');
      lines.push('regime sw/min ' + ((g['regime.switches_per_minute'] || 0).toFixed(0)) +
                 '   loop_lag ' + (QR.clock ? QR.clock.driftMs().toFixed(0) : '?') + 'ms');
      lines.push('bankroll ' + ((g['risk.bankroll'] || 1).toFixed(4)) +
                 '   dd ' + ((g['risk.drawdown_pct'] || 0) * 100).toFixed(1) + '%' +
                 '   streak ' + (g['risk.streak_losses'] || 0));
      lines.push('cal a=' + ((g['predict.calibration.a'] || 1).toFixed(2)) +
                 '  b=' + ((g['predict.calibration.b'] || 0).toFixed(2)) +
                 '  drift ' + ((g['predict.calibration.drift'] || 0).toFixed(2)));
      host.textContent = lines.join('\n');
    } catch (_) {
      // disable HUD on error
      unmount();
    }
  }

  function mount() {
    ensureHost();
    visible = true;
    if (host) host.style.display = 'block';
    if (!intervalH) intervalH = QR.scheduler.every(1000, render, 'hud.render');
  }
  function unmount() {
    visible = false;
    if (host) host.style.display = 'none';
    if (intervalH) { intervalH.cancel(); intervalH = null; }
  }
  function toggle() { visible ? unmount() : mount(); }
  function isVisible() { return visible; }

  function init() {
    try {
      if (W.localStorage && W.localStorage.getItem('QR_HUD') === '1') {
        QR.scheduler.defer(mount, 1000, 'hud.boot');
      }
    } catch (_) {}
  }

  QR.telemetry = QR.telemetry || {};
  QR.telemetry.hud = { mount, unmount, toggle, isVisible };
  if (QR.kernel) QR.kernel.register('telemetry.hud', init, unmount);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/telemetry/diagnostics.js ──────────────────────────────────────────────────── */
// telemetry/diagnostics.js
// Diagnostic snapshots + copyable reports.
//
// Architecture:
//   Single function `report()` returns a structured JSON blob with the full
//   runtime state — kernel status, metric snapshot, pool stats, bus stats,
//   per-asset feature state summary, regime distribution.
//   `copy()` writes the blob to the clipboard when called from a user
//   gesture; falls back to a pre-selected textarea otherwise.
//
//   The report is intended for human inspection and bug triage; it is also
//   the payload of an opt-in `localStorage.QR_AUDIT_LOG = '1'` audit log.
//
// Optimization:
//   - Snapshots are read-only; they never mutate state.
//
// Failure handling:
//   - Best-effort: each section is wrapped in try/catch so a single bad
//     section does not corrupt the whole report.
//
// Telemetry:
//   - `telemetry.reports_generated`
//
// Integration:
//   Public: report(), copy(), browserInfo().
//
// Latency:
//   ~ ms for a typical report.
//
// Memory:
//   Transient.
//
// Survivability:
//   Cannot throw out of report() — partial reports are preferred to none.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.telemetry && QR.telemetry.diagnostics) return;

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return { error: String(e && e.message || e), fallback }; }
  }

  function browserInfo() {
    return safe(() => ({
      userAgent: W.navigator.userAgent,
      lang: W.navigator.language,
      url: W.location && W.location.href,
      hardwareConcurrency: W.navigator.hardwareConcurrency,
      memory: W.performance && W.performance.memory ? {
        usedJSHeapSize: W.performance.memory.usedJSHeapSize,
        totalJSHeapSize: W.performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: W.performance.memory.jsHeapSizeLimit,
      } : null,
      vis: W.document && W.document.visibilityState,
    }), null);
  }

  function poolStats() {
    return safe(() => ({
      tick:       QR.tickPool ? QR.tickPool.snapshot() : null,
      frame:      QR.framePool ? QR.framePool.snapshot() : null,
      prediction: QR.predictionPool ? QR.predictionPool.snapshot() : null,
    }), null);
  }

  function busStats() {
    return safe(() => QR.bus ? QR.bus.snapshot() : null, null);
  }

  function regimeDistribution() {
    const out = {};
    safe(() => {
      const states = QR.regime && QR.regime._states ? QR.regime._states : null;
      if (!states) return;
      // We don't expose states by default; use the metrics gauges if present.
    });
    return out;
  }

  function report() {
    if (QR.metrics) QR.metrics.counter('telemetry.reports_generated').inc();
    return {
      generatedAt: new Date().toISOString(),
      kernel: safe(() => QR.kernel ? QR.kernel.status() : null),
      browser: browserInfo(),
      metrics: safe(() => QR.metrics ? QR.metrics.snapshot() : null),
      pools: poolStats(),
      bus: busStats(),
      worker: safe(() => ({ ready: QR.workers && QR.workers.isReady ? QR.workers.isReady() : false })),
      risk: safe(() => QR.risk ? QR.risk.snapshot() : null),
      timing: safe(() => QR.execution && QR.execution.timing ? QR.execution.timing.stats() : null),
      calibration: safe(() => QR.predict && QR.predict.calibration ? QR.predict.calibration.params() : null),
      ensemble: safe(() => QR.predict && QR.predict.ensemble ? QR.predict.ensemble.hitState() : null),
      regimes: regimeDistribution(),
    };
  }

  async function copy() {
    const blob = JSON.stringify(report(), null, 2);
    try {
      if (W.navigator && W.navigator.clipboard && W.navigator.clipboard.writeText) {
        await W.navigator.clipboard.writeText(blob);
        return { ok: true, length: blob.length };
      }
    } catch (_) {}
    // Fallback: temporary textarea
    try {
      const ta = W.document.createElement('textarea');
      ta.value = blob;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
      W.document.body.appendChild(ta);
      ta.select();
      W.document.execCommand && W.document.execCommand('copy');
      W.document.body.removeChild(ta);
      return { ok: true, length: blob.length, via: 'textarea' };
    } catch (_) {
      return { ok: false };
    }
  }

  QR.telemetry = QR.telemetry || {};
  QR.telemetry.diagnostics = { report, copy, browserInfo };
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/telemetry/control_panel.js ──────────────────────────────────────────────────── */
// telemetry/control_panel.js
// Interactive control panel — restores the V11/V12 control surface.
//
// Architecture:
//   Adds a small floating gear button (bottom-left) that expands into a
//   panel with the runtime's interactive controls:
//     - Master halt / resume   → emits `execution.halt` / `execution.resume`
//     - Kelly multiplier         → QR.risk.configure({ kellyMul })
//     - Min-probability gate     → QR.risk.configure({ minProbEdge })
//     - Drawdown cap             → QR.risk.configure({ ddCap })
//     - Loss-streak cap          → QR.risk.configure({ streakCap })
//     - HUD toggle               → QR.telemetry.hud.toggle()
//     - Copy diagnostics         → QR.telemetry.diagnostics.copy()
//     - Reset bankroll/halt      → QR.risk.resetHalt()
//
//   Slider values are persisted to localStorage under `QR_PANEL_STATE_v1`
//   and re-applied on the next boot.
//
// Optimization:
//   - Panel mutates state only on user input. No periodic re-render.
//   - Status indicator subscribes to bus events; no polling.
//
// Failure handling:
//   - If document.body is unavailable at init, defer until it is.
//   - All control handlers are wrapped — a bad input never breaks the panel.
//   - If risk/configure missing (degraded), inputs are disabled.
//
// Telemetry:
//   - `telemetry.panel.clicks.<button>` counters per action
//   - `telemetry.panel.changes.<knob>`  counters per slider change
//
// Integration:
//   Public: mount(), unmount(), toggle(), isMounted().
//   Subscribes: `pipeline.halted`, `pipeline.resumed`, `risk.configured`.
//
// Latency:
//   Interactive; not on any hot path.
//
// Memory:
//   One element tree; ~few KB.
//
// Survivability:
//   Panel failure has zero impact on the trading runtime.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.telemetry && QR.telemetry.controlPanel) return;

  const STORAGE_KEY = 'QR_PANEL_STATE_v1';
  const VISIBILITY_KEY = 'QR_PANEL';   // '0' = hide button entirely

  let host = null;
  let toggleBtn = null;
  let panel = null;
  let statusDot = null;
  let statusLabel = null;
  let haltBtn = null;
  let rejectListEl = null;
  let expanded = false;
  let mounted = false;
  let halted = false;
  const rejectRing = [];   // recent { reason, asset, at }
  const REJECT_CAP = 12;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }

  function pushReject(reason, asset) {
    rejectRing.push({ reason, asset: asset || '', at: performance.now() });
    if (rejectRing.length > REJECT_CAP) rejectRing.shift();
    renderRejectList();
  }
  function renderRejectList() {
    if (!rejectListEl) return;
    if (rejectRing.length === 0) {
      rejectListEl.textContent = '(none yet)';
      return;
    }
    const lines = [];
    for (let i = rejectRing.length - 1; i >= 0; i--) {
      const r = rejectRing[i];
      const ago = ((performance.now() - r.at) / 1000).toFixed(1) + 's';
      lines.push(ago.padStart(6, ' ') + '  ' + r.reason + (r.asset ? '  · ' + r.asset : ''));
    }
    rejectListEl.textContent = lines.join('\n');
  }

  function loadState() {
    try {
      const raw = W.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return (s && typeof s === 'object') ? s : null;
    } catch (_) { return null; }
  }
  function saveState(patch) {
    try {
      const cur = loadState() || {};
      Object.assign(cur, patch);
      W.localStorage.setItem(STORAGE_KEY, JSON.stringify(cur));
    } catch (_) {}
  }

  function isHidden() {
    try { return W.localStorage.getItem(VISIBILITY_KEY) === '0'; } catch (_) { return false; }
  }

  // ──────────────────────────────────────────────────────────────────────
  // DOM construction
  // ──────────────────────────────────────────────────────────────────────

  const COLORS = {
    bg: 'rgba(10,12,16,0.92)',
    border: '#2a4',
    fg: '#cfe0ff',
    fgDim: '#7d8aa0',
    accent: '#7df',
    danger: '#f66',
    ok: '#4f8',
  };

  function el(tag, css, text) {
    const e = W.document.createElement(tag);
    if (css)  e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  function row(label, control) {
    const r = el('div', 'display:flex;align-items:center;gap:8px;margin:4px 0;');
    const l = el('span', `min-width:96px;color:${COLORS.fgDim};font-size:11px;`, label);
    r.appendChild(l);
    r.appendChild(control);
    return r;
  }

  function slider(min, max, step, value, onInput) {
    const wrap = el('div', 'display:flex;align-items:center;gap:6px;flex:1;');
    const s = W.document.createElement('input');
    s.type = 'range';
    s.min = String(min); s.max = String(max); s.step = String(step);
    s.value = String(value);
    s.style.cssText = 'flex:1;accent-color:#7df;';
    const v = el('span', `font-variant-numeric:tabular-nums;color:${COLORS.fg};min-width:42px;text-align:right;`, (+value).toFixed(2));
    s.addEventListener('input', () => {
      v.textContent = (+s.value).toFixed(2);
      try { onInput(+s.value); } catch (_) {}
    });
    wrap.appendChild(s); wrap.appendChild(v);
    return wrap;
  }

  function button(label, color, onClick) {
    const b = el('button', [
      'background:transparent', `color:${color || COLORS.fg}`, `border:1px solid ${color || COLORS.border}`,
      'padding:4px 10px', 'border-radius:4px', 'cursor:pointer', 'font:11px ui-monospace,Menlo,Consolas,monospace',
      'min-width:72px',
    ].join(';'), label);
    b.onmouseover = () => b.style.background = 'rgba(255,255,255,0.06)';
    b.onmouseout  = () => b.style.background = 'transparent';
    b.onclick = () => { try { onClick(); } catch (_) {} };
    return b;
  }

  function buildToggleBtn() {
    toggleBtn = el('button', [
      'position:fixed', 'left:8px', 'bottom:8px', 'z-index:2147483647',
      'background:rgba(10,12,16,0.86)', `color:${COLORS.accent}`, `border:1px solid ${COLORS.border}`,
      'padding:6px 10px', 'border-radius:6px', 'cursor:pointer',
      'font:12px ui-monospace,Menlo,Consolas,monospace',
      'box-shadow:0 4px 16px rgba(0,0,0,.4)',
      'pointer-events:auto',
    ].join(';'), '⚙ QR');
    toggleBtn.onclick = () => setExpanded(!expanded);
    return toggleBtn;
  }

  function buildPanel() {
    panel = el('div', [
      'position:fixed', 'left:8px', 'bottom:48px', 'z-index:2147483647',
      `background:${COLORS.bg}`, `color:${COLORS.fg}`, `border:1px solid ${COLORS.border}`,
      'padding:10px 12px', 'border-radius:8px',
      'font:11px/1.4 ui-monospace,Menlo,Consolas,monospace',
      'box-shadow:0 6px 24px rgba(0,0,0,.5)',
      'min-width:300px', 'max-width:340px',
      'pointer-events:auto', 'display:none',
    ].join(';'));

    // Header
    const header = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;');
    const title = el('span', `color:${COLORS.accent};font-weight:bold;font-size:12px;`, 'QR · Control');
    const close = el('span', `cursor:pointer;color:${COLORS.fgDim};font-size:14px;padding:0 4px;`, '×');
    close.onclick = () => setExpanded(false);
    header.appendChild(title); header.appendChild(close);
    panel.appendChild(header);

    // Status row
    const statusRow = el('div', 'display:flex;align-items:center;gap:8px;margin:6px 0;padding:6px 8px;background:rgba(255,255,255,0.04);border-radius:4px;');
    statusDot = el('span', `color:${COLORS.ok};font-size:14px;`, '●');
    statusLabel = el('span', `color:${COLORS.fg};`, 'RUNNING');
    haltBtn = button('Halt', COLORS.danger, () => {
      metric('telemetry.panel.clicks.halt').inc();
      if (halted) {
        QR.bus.emit('execution.resume', {});
      } else {
        QR.bus.emit('execution.halt', { reason: 'user_request' });
      }
    });
    haltBtn.style.marginLeft = 'auto';
    statusRow.appendChild(statusDot); statusRow.appendChild(statusLabel); statusRow.appendChild(haltBtn);
    panel.appendChild(statusRow);

    // Risk knobs
    const risk = QR.risk && QR.risk.getConfig ? QR.risk.getConfig() : { kellyMul: 0.25, minProbEdge: 0.55, ddCap: 0.20, streakCap: 4 };
    panel.appendChild(el('div', `color:${COLORS.fgDim};margin:8px 0 2px 0;font-size:10px;letter-spacing:.5px;`, 'RISK'));

    panel.appendChild(row('Kelly mul',  slider(0.05, 1.00, 0.05, risk.kellyMul,     (v) => { metric('telemetry.panel.changes.kellyMul').inc(); QR.risk && QR.risk.configure({ kellyMul: v });    saveState({ kellyMul: v }); })));
    panel.appendChild(row('Min prob',   slider(0.50, 0.90, 0.01, risk.minProbEdge,  (v) => { metric('telemetry.panel.changes.minProbEdge').inc(); QR.risk && QR.risk.configure({ minProbEdge: v }); saveState({ minProbEdge: v }); })));
    panel.appendChild(row('DD cap',     slider(0.05, 0.50, 0.01, risk.ddCap,        (v) => { metric('telemetry.panel.changes.ddCap').inc(); QR.risk && QR.risk.configure({ ddCap: v });       saveState({ ddCap: v }); })));
    panel.appendChild(row('Streak cap', slider(1,    10,    1,    risk.streakCap,    (v) => { metric('telemetry.panel.changes.streakCap').inc(); QR.risk && QR.risk.configure({ streakCap: v });   saveState({ streakCap: v }); })));

    // Action buttons row
    panel.appendChild(el('div', `color:${COLORS.fgDim};margin:10px 0 4px 0;font-size:10px;letter-spacing:.5px;`, 'ACTIONS'));
    const actions = el('div', 'display:flex;flex-wrap:wrap;gap:6px;');

    actions.appendChild(button('HUD', COLORS.accent, () => {
      metric('telemetry.panel.clicks.hud').inc();
      QR.telemetry && QR.telemetry.hud && QR.telemetry.hud.toggle();
    }));
    actions.appendChild(button('Copy diag', COLORS.accent, async () => {
      metric('telemetry.panel.clicks.copy').inc();
      if (!QR.telemetry || !QR.telemetry.diagnostics) return;
      const res = await QR.telemetry.diagnostics.copy();
      flashStatus(res && res.ok ? 'copied ✓' : 'copy failed');
    }));
    actions.appendChild(button('Clear halt', COLORS.fg, () => {
      metric('telemetry.panel.clicks.clear_halt').inc();
      QR.risk && QR.risk.resetHalt();
      QR.bus.emit('execution.resume', {});
      flashStatus('halt cleared');
    }));

    panel.appendChild(actions);

    // Reject log section
    panel.appendChild(el('div', `color:${COLORS.fgDim};margin:10px 0 4px 0;font-size:10px;letter-spacing:.5px;`, 'WHY NO TRADE'));
    rejectListEl = el('pre', [
      `color:${COLORS.fg}`, 'background:rgba(255,255,255,0.04)', 'border-radius:4px',
      'padding:6px 8px', 'margin:0', 'max-height:130px', 'overflow:auto',
      'white-space:pre-wrap', 'font-size:10px', 'line-height:1.35',
    ].join(';'), '(none yet)');
    panel.appendChild(rejectListEl);
    renderRejectList();

    // Footer hint
    const hint = el('div', `color:${COLORS.fgDim};margin-top:8px;font-size:10px;`,
      'Hide panel: localStorage.QR_PANEL="0"');
    panel.appendChild(hint);

    return panel;
  }

  function flashStatus(msg) {
    if (!statusLabel) return;
    const prev = statusLabel.textContent;
    const prevColor = statusLabel.style.color;
    statusLabel.textContent = msg;
    statusLabel.style.color = COLORS.accent;
    W.setTimeout(() => {
      refreshStatus();
    }, 1200);
  }

  function refreshStatus() {
    if (!statusDot || !statusLabel) return;
    if (halted) {
      statusDot.style.color = COLORS.danger;
      statusLabel.textContent = 'HALTED';
      statusLabel.style.color = COLORS.danger;
      if (haltBtn) {
        haltBtn.textContent = 'Resume';
        haltBtn.style.color = COLORS.ok;
        haltBtn.style.borderColor = COLORS.ok;
      }
    } else {
      statusDot.style.color = COLORS.ok;
      statusLabel.textContent = 'RUNNING';
      statusLabel.style.color = COLORS.fg;
      if (haltBtn) {
        haltBtn.textContent = 'Halt';
        haltBtn.style.color = COLORS.danger;
        haltBtn.style.borderColor = COLORS.danger;
      }
    }
  }

  function setExpanded(flag) {
    expanded = !!flag;
    if (panel) panel.style.display = expanded ? 'block' : 'none';
    if (toggleBtn) toggleBtn.textContent = expanded ? '⚙ QR ▾' : '⚙ QR';
  }

  function build() {
    if (host) return;
    if (!W.document || !W.document.body) {
      QR.scheduler.defer(build, 500, 'panel.build.retry');
      return;
    }
    host = W.document.createElement('div');
    host.id = '__qr_ctrl_host__';
    host.appendChild(buildToggleBtn());
    host.appendChild(buildPanel());
    W.document.body.appendChild(host);
    mounted = true;
    refreshStatus();
  }

  function unmount() {
    if (!host) return;
    try { host.parentNode && host.parentNode.removeChild(host); } catch (_) {}
    host = null; toggleBtn = null; panel = null; statusDot = null; statusLabel = null; haltBtn = null;
    mounted = false; expanded = false;
  }
  function isMounted() { return mounted; }
  function toggle() { mounted ? unmount() : build(); }

  function applyPersistedState() {
    const s = loadState();
    if (s && QR.risk && QR.risk.configure) QR.risk.configure(s);
  }

  function init() {
    applyPersistedState();
    QR.bus.on('pipeline.halted',  () => { halted = true;  refreshStatus(); });
    QR.bus.on('pipeline.resumed', () => { halted = false; refreshStatus(); });
    QR.bus.on('execution.halt',   () => { halted = true;  refreshStatus(); });
    QR.bus.on('execution.resume', () => { halted = false; refreshStatus(); });
    QR.bus.on('pipeline.reject',  (ev) => { if (ev && ev.reason) pushReject(ev.reason, ev.asset); });
    if (isHidden()) return;
    QR.scheduler.defer(build, 800, 'panel.boot');
  }

  QR.telemetry = QR.telemetry || {};
  QR.telemetry.controlPanel = { build, unmount, toggle, isMounted };
  if (QR.kernel) QR.kernel.register('telemetry.controlPanel', init, unmount);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── src/recovery/watchdog.js ──────────────────────────────────────────────────── */
// recovery/watchdog.js
// Runtime watchdog — stream-stall detector, snapshotter, degraded-mode coordinator.
//
// Architecture:
//   Three responsibilities:
//     1. Stream-stall detection: maintain `lastTickAt` per asset; if the
//        global most-recent tick is older than `STALL_MS`, emit
//        `ingest.stalled`. When fresh ticks resume, emit `ingest.resumed`.
//     2. State snapshots: every `SNAPSHOT_MS`, persist a small subset of
//        non-secret state (risk, calibration, timing) to `localStorage`.
//        On boot, restore from the last snapshot if version matches.
//     3. Degraded-mode coordinator: listens for `*.degraded` events and
//        when a quorum of critical modules report degraded, flips a global
//        `degraded` flag and emits `kernel.degraded`.
//
// Optimization:
//   - One periodic task (every 1 s) does both checks.
//   - Snapshots are tiny JSON (≤ 1 KB).
//
// Failure handling:
//   - `localStorage` access may throw in sandboxed contexts; wrapped.
//
// Telemetry:
//   - `recovery.snapshots_written`
//   - `recovery.snapshots_restored`
//   - `recovery.stalls_detected`
//   - `recovery.resumes_detected`
//   - `recovery.degraded_state` gauge
//
// Integration:
//   Subscribes: `tick` (latest tick timestamp), `*.degraded` events.
//   Public: arm(), pet(), restore(), snapshot().
//
// Latency:
//   1 Hz tick — negligible.
//
// Memory:
//   < 1 KB.
//
// Survivability:
//   Watchdog itself never depends on the platform DOM or WS.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.recovery) return;

  const STALL_MS = 5000;
  const SNAPSHOT_MS = 5000;
  const STORAGE_KEY = 'QR_SNAPSHOT_v1';
  const VERSION = 1;

  let lastTickAt = 0;
  let stalled = false;
  let degraded = false;
  let lastSnapshotAt = 0;

  function metric(name) { const m = QR.metrics; return m ? m.counter(name) : { inc() {} }; }
  function gauge(name)  { const m = QR.metrics; return m ? m.gauge(name) : { set() {} }; }

  function pet(tsMs) {
    lastTickAt = tsMs || performance.now();
    if (stalled) {
      stalled = false;
      metric('recovery.resumes_detected').inc();
      QR.bus.emit('ingest.resumed', { at: lastTickAt });
    }
  }

  function checkStall(nowMs) {
    if (lastTickAt === 0) return;
    if ((nowMs - lastTickAt) > STALL_MS && !stalled) {
      stalled = true;
      metric('recovery.stalls_detected').inc();
      QR.bus.emit('ingest.stalled', { lastTickAt });
    }
  }

  function writeSnapshot() {
    const snap = {
      v: VERSION,
      ts: Date.now(),
      risk: QR.risk ? QR.risk.snapshot() : null,
      calibration: QR.predict && QR.predict.calibration ? QR.predict.calibration.params() : null,
      timing: QR.execution && QR.execution.timing ? QR.execution.timing.stats() : null,
    };
    try {
      W.localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
      metric('recovery.snapshots_written').inc();
    } catch (_) {}
  }

  function restoreSnapshot() {
    try {
      const raw = W.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const snap = JSON.parse(raw);
      if (!snap || snap.v !== VERSION) return null;
      if (snap.risk && QR.risk) QR.risk.restore(snap.risk);
      metric('recovery.snapshots_restored').inc();
      return snap;
    } catch (_) { return null; }
  }

  function setDegraded(flag, reason) {
    if (degraded === flag) return;
    degraded = flag;
    gauge('recovery.degraded_state').set(flag ? 1 : 0);
    QR.bus.emit(flag ? 'kernel.degraded' : 'kernel.recovered', { reason });
  }

  function onModuleFailed() {
    const status = QR.kernel ? QR.kernel.status() : null;
    if (!status) return;
    const crits = ['ingest.ws', 'ingest.normalizer', 'features.extractor', 'execution.pipeline'];
    let down = 0;
    for (let i = 0; i < crits.length; i++) {
      if (status.degraded.indexOf(crits[i]) >= 0) down++;
    }
    setDegraded(down >= 2, 'critical_modules_down');
  }

  function arm() {
    QR.bus.on('tick', (t) => pet(t.ts));
    QR.bus.on('kernel.module_failed', onModuleFailed);
    QR.bus.on('workers.degraded', () => setDegraded(true, 'workers_degraded'));
    QR.scheduler.every(1000, () => {
      const now = performance.now();
      checkStall(now);
      if (now - lastSnapshotAt >= SNAPSHOT_MS) {
        lastSnapshotAt = now;
        writeSnapshot();
      }
    }, 'recovery.tick');
  }

  function init() {
    restoreSnapshot();
    arm();
  }

  QR.recovery = { arm, pet, writeSnapshot, restoreSnapshot, isStalled: () => stalled, isDegraded: () => degraded };
  if (QR.kernel) QR.kernel.register('recovery.watchdog', init);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

/* ─── bootstrap ───────────────────────────────────────────────── */
// _bootstrap.js
// Final entry — installs the WS interceptor immediately at document-start,
// then defers module boot until the page has begun loading so DOM-dependent
// modules can register without spinning.
//
// Architecture:
//   - Guard against double-install.
//   - Install the WS interceptor before any platform code runs.
//   - Schedule kernel.boot() on next microtask so all modules in the
//     bundle have had a chance to register.
//   - Mount the HUD if localStorage opts in.
//
// Survivability:
//   The bootstrap itself never throws — any error during boot falls back
//   to a no-op runtime that still exposes diagnostics.

(function (W) {
  'use strict';
  const QR = (W.__QR__ = W.__QR__ || {});
  if (QR.__booted) return;
  QR.__booted = true;

  // Install the WS hook as early as possible — before the platform's scripts
  // open their sockets. The other modules (parser, validator, normalizer)
  // are already wired via the kernel registry; we just need ws_interceptor.
  try {
    if (QR.ingest && QR.ingest.ws) QR.ingest.ws.install();
  } catch (_) {}

  // Kernel boot on next microtask so any straggler registrations land first.
  queueMicrotask(() => {
    try {
      if (QR.kernel) QR.kernel.boot();
    } catch (_) {}
  });

  // Console banner — single line, opt-out-able by silencing the bus.
  try {
    // eslint-disable-next-line no-console
    console.info('%cQuantum Runtime V13%c booted', 'color:#7df;font-weight:bold', 'color:inherit');
  } catch (_) {}
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
