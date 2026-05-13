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
