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
