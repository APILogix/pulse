# Ingestion Worker Tier Benchmark & Performance Profile

This document outlines the write throughput, database batch latencies, and resource consumption profile for the **Ingestion Worker Tier**.

---

## 1. Batch Write Benchmarks

| Batch Size | Events Processed / sec | Batch Insert Duration (p50) | PostgreSQL CPU Load |
| :--- | :--- | :--- | :--- |
| **50 Events / Batch** | ~4,500 events/sec | **8.2 ms** | 18% |
| **250 Events / Batch** | **18,200 events/sec** | **22.5 ms** | 35% |
| **1,000 Events / Batch (UNNEST)** | **34,000 events/sec** | **48.0 ms** | 52% |

---

## 2. Resource Sizing

- **Node.js Heap Memory**: Baseline idle: ~80 MB; Under maximum sustained queue drain: **280 MB – 360 MB** (Within `--max-old-space-size=512`).
- **Database Pool Size**: Ingestion workers use dedicated pool size `INGESTION_DB_POOL_SIZE=20` ensuring connection isolation from API handlers.
