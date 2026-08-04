/**
 * Dedicated analytics worker process.
 *
 * Spec: docs/analytics/06-worker-architecture.md §1
 *
 * Boot sequence:
 *   1. open a dedicated Log DB pool (small, so analytics can never starve the
 *      ingestion writer pool)
 *   2. assert this pool owns events_* and the rollups exist
 *   3. ensure partitions before any worker can write
 *   4. start pg-boss (supervise + schedule enabled for worker roles)
 *   5. register the analytics workers and the dispatcher
 *   6. expose health + Prometheus metrics
 *   7. drain cleanly on SIGTERM/SIGINT
 *
 * ISOLATION: this process registers NO ingestion queue and imports nothing from
 * src/modules/ingestion. Analytics never blocks ingestion
 * (docs/analytics/00-architecture-overview.md §3).
 */
export {};
//# sourceMappingURL=analytics-worker-main.d.ts.map