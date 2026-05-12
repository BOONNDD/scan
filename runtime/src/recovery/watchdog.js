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
