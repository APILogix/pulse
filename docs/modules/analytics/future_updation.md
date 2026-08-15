# Analytics Module (v1) Future Updates & Deprecation Roadmap

This document describes the deprecation schedule for the v1 analytics module and its full replacement by the **Analytics Engine (v2)**.

---

## 1. Deprecation Strategy & Transition to v2

- **Limitation of v1**: Querying raw telemetry tables with `DATE_TRUNC` and `PERCENTILE_CONT` scales poorly as row counts exceed $10^7$ events.
- **Migration Plan**:
  1. **Dual Running Phase**: Frontend routes migrated from `/api/v1/analytics/*` to `/api/v2/analytics-engine/*`.
  2. **Wave 7 Deprecation**: Complete retirement and deletion of `modules/analytics` in favor of precomputed rollups in `modules/analytics-engine`.
