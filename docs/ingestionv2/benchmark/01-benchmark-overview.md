# 01 — Benchmark overview

Status: framework built; **BENCHMARK NOT EXECUTED**.

## Purpose

Determine the real, evidence-backed ingestion capacity of the deployed Pulse ingestion pipeline: sustainable events/second and events/minute, saturation point, latency percentiles, dominant bottleneck at each load level, and whether an upgraded Neon plan would materially help — without degrading, bypassing, or modifying production ingestion behavior.

## What was built

| Component | File | Role |
| --- | --- | --- |
| Safety gating | `scripts/bench/http-safety.ts` | Environment allowlist (reused from `scripts/lib/ingestion-evidence.ts`) + production-looking target URL rejection. Ramp/burst/sustained/soak are unconditionally refused against anything production-looking. |
| Fixture provisioning | `scripts/bench/provision-benchmark-fixture.ts` | Creates a real, clearly-tagged benchmark org/project/environment/API-key via the same key-material/hash contract the real auth path verifies. Idempotent; prints its own cleanup SQL. |
| Workload profiles | `scripts/bench/workload-profiles.ts` | 9 required profiles; every payload validated against the actual `event-normalizer.ts` Zod schemas. |
| Duplicate safety gate | `scripts/bench/duplicate-safety-gate.ts` | Refuses log-touching duplicate-heavy runs unless the target's `events_logs` unique guard is confirmed present. |
| Request engine | `scripts/bench/http-request-engine.ts` | Fires real `POST /api/v1/<type>` requests with a real API key; tracks offered/accepted/rejected/duplicate counts and latency. |
| Metrics collector | `scripts/bench/metrics-collector.ts` | Scrapes worker Prometheus output + optional read-only Postgres sampling, concurrently with a run. |
| Sustainability evaluator | `scripts/bench/sustainability.ts` | Implements spec §10's stop/pass criteria against actually-measured samples; unmeasured criteria are reported as such, never assumed passing. |
| Mode controllers | `scripts/bench/load-modes.ts` | Ramp-to-saturation (stop at first violation + recovery check), burst cycles, sustained, soak (with a degradation-trend heuristic). |
| CLI entrypoint | `scripts/bench-ingestion-http.ts` | Wires every gate and mode together; outputs one JSON report per run. |
| Index/trigger A/B scaffolding | `scripts/bench/index-trigger-ab.ts`, `scripts/bench/observe-public-id-mechanism.ts` | Isolated-schema-only orchestration (not executable without an isolated target) + a read-only public-ID mechanism observer (safe against any target). |

Every file above passed `npm run build` (TypeScript compilation) and has zero LSP diagnostics.

## What was NOT executed, and why

No run of any kind — baseline, fixed-rate, ramp, burst, sustained, or soak — has completed against any target. This session had no reachable backend (no running API process) and no live database credentials in the working environment (only `.env.example`, no `.env`). The operator was asked to run the two required commands (fixture provisioning + a baseline smoke run) and paste back output; that did not happen in this session, and the decision was made to ship the complete framework and documentation now, with real execution to follow whenever the backend is running.

**No capacity number in this report set is invented.** Every quantitative claim in reports 04–14 is either a static configuration fact (cited to source) or `NOT MEASURED`.

## How to get real numbers

See [`README.md`](README.md) §2-§3 for the exact commands. In short: provision a fixture once, then run `npm run bench:ingestion:http:fast-regression` for a 20-second smoke check, or the full mode commands for real capacity numbers.

## Relationship to prior ingestion audit

This benchmark framework is a separate, additive deliverable from the earlier `ingestionv2/` correctness-hardening audit (cancellation, UsageCounter, documentation). It reuses that audit's evidence-labeling discipline (`MEASURED`/`DERIVED`/`UNVERIFIED`/`UNKNOWN` — here rendered as measured facts vs. `NOT MEASURED`) and its environment-safety primitives, but produces an independent report set focused on capacity/load rather than correctness.

## Related documents

- [Test methodology](02-test-methodology.md)
- [Discovered architecture](00-discovered-architecture.md)
- [Tooling classification](01-tooling-classification.md)
