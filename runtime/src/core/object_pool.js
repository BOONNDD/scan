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
