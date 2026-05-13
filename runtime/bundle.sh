#!/usr/bin/env bash
# bundle.sh
# Concatenate runtime modules into a single Tampermonkey userscript.
# Order is dependency-correct: metrics first (everything emits to it),
# then core (clock, ring, pool, scheduler, bus, kernel), then producers,
# consumers, and the bootstrap entry last.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="${ROOT}/candle_V13_QUANTUM.user.js"
HEADER="${ROOT}/src/_userscript_header.js"
BOOT="${ROOT}/src/_bootstrap.js"

# Strict module order — every line must be valid; missing files fail the build.
MODULES=(
  src/telemetry/metrics.js
  src/core/clock.js
  src/core/ring_buffer.js
  src/core/object_pool.js
  src/core/scheduler.js
  src/core/event_bus.js
  src/core/kernel.js

  src/dom/self_healing.js

  src/workers/compute_worker.js
  src/workers/orchestrator.js

  src/ingest/binary_parser.js
  src/ingest/packet_validator.js
  src/ingest/tick_normalizer.js
  src/ingest/ws_interceptor.js

  src/features/extractor.js
  src/regime/classifier.js

  src/predict/models.js
  src/predict/calibration.js
  src/predict/sequence_inference.js
  src/predict/ensemble.js

  src/risk/risk_engine.js

  src/execution/timing_engine.js
  src/execution/dom_actuator.js
  src/execution/pipeline.js

  src/telemetry/hud.js
  src/telemetry/diagnostics.js
  src/telemetry/control_panel.js

  src/recovery/watchdog.js
)

if [[ ! -f "$HEADER" ]]; then
  echo "missing header: $HEADER" >&2; exit 1
fi
if [[ ! -f "$BOOT" ]]; then
  echo "missing boot: $BOOT" >&2; exit 1
fi

{
  cat "$HEADER"
  echo ""
  for m in "${MODULES[@]}"; do
    if [[ ! -f "${ROOT}/${m}" ]]; then
      echo "missing module: ${m}" >&2; exit 1
    fi
    echo ""
    echo "/* ─── ${m} ──────────────────────────────────────────────────── */"
    cat "${ROOT}/${m}"
  done
  echo ""
  echo "/* ─── bootstrap ───────────────────────────────────────────────── */"
  cat "$BOOT"
} > "$OUT"

bytes=$(wc -c < "$OUT" | tr -d ' ')
lines=$(wc -l < "$OUT" | tr -d ' ')
echo "wrote $OUT — ${lines} lines, ${bytes} bytes"
