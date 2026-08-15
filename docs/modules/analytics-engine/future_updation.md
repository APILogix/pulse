# Analytics Engine (v2) Future Updates & Roadmap

This document describes upcoming features, scaling plans, and architectural enhancements for the **Analytics Engine (v2)**.

---

## 1. Native Columnar Aggregation (ClickHouse Integration)

- **Phase 1 (Current)**: PostgreSQL rollup tables with JSONB sketches and whole-bucket recomputation.
- **Phase 2 (Target)**: Direct offloading of rollups to ClickHouse `AggregatingMergeTree` with native `AggregateFunction(quantilesExactWeighted, ...)` and `AggregateFunction(uniqHLL12, ...)` engines for infinite horizontal scalability.

---

## 2. Advanced Analytics Capabilities

1. **Multi-Dimensional Slice & Dice**: Dynamic arbitrary GROUP BY across custom user attributes and deployment tags.
2. **Predictive Anomaly Detection**: Statistical Holt-Winters and Z-Score anomaly flagging embedded into the hourly rollup worker.
3. **Automated Query Cost & Cache Layer**: Distributed Redis caching for complex multi-project dashboard aggregations.
