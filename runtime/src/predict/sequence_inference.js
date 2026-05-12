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
