# Ingestion Worker Tier Future Updates & Roadmap

This document describes upcoming pipeline optimizations and high-volume stream persistence upgrades for the **Ingestion Worker Tier**.

---

## 1. Planned Roadmap

1. **Direct ClickHouse / Columnar Batch Sink**: Enable direct ClickHouse batch writing via native TCP protocol for 50x higher event throughput.
2. **Dynamic Consumer Auto-Scaling**: Integrate Kubernetes KEDA (Kubernetes Event-driven Autoscaling) to scale worker pods dynamically based on pg-boss queue depth metrics.
3. **Zero-Copy Native PostgreSQL Binary Protocol (`pg_copy_from`)**: Upgrade from `UNNEST()` to native binary `COPY` streams for maximum write throughput.
