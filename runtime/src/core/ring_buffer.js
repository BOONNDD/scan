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
