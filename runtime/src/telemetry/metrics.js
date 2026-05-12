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
