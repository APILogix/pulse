# Background Worker Tier Benchmark & Performance Profile

This document details job processing throughput, handler latency, and memory footprints for the **Background Worker Tier**.

---

## 1. Benchmarks

| Job Queue | Job Concurrency | Processing Latency (p50) | Throughput Capacity |
| :--- | :--- | :--- | :--- |
| **`alert-evaluator`** | 10 workers | **14.2 ms** | 700 evaluations/sec |
| **`auth-email` / `org-email`** | 5 workers | **220 ms** (SMTP dispatch) | ~25 emails/sec |
| **`billing-reconcile`** | 2 workers | **45 ms** | 45 reconciliations/sec |
| **`telemetry-maintenance`** | 1 worker (Daily) | **1.4 s** (Partition roll) | N/A |

---

## 2. Resource Overhead

- **Memory Usage**: ~120 MB idle, ~240 MB under heavy alert evaluation bursts.
- **Connection Pools**: Dedicated background PG pool configured with `max: 20` connections.
