# Observability Module Benchmark & Performance Profile

This document details performance benchmarks for trace waterfall tree assembly, span lookups, and service graph generation in the **Observability Module**.

---

## 1. Trace Reconstruction Benchmarks

| Operation | 10 Spans (Simple Trace) | 250 Spans (Microservices Trace) | 2,000 Spans (Distributed Batch) |
| :--- | :--- | :--- | :--- |
| **Span Query Time (LogDB)** | 2.1 ms | 12.4 ms | 68.2 ms |
| **Tree Construction & Formatting** | 0.3 ms | 2.1 ms | 14.8 ms |
| **Total Response Latency (p50)** | **4.2 ms** | **18.5 ms** | **94.0 ms** |
| **Total Response Latency (p95)** | **8.8 ms** | **34.2 ms** | **145.0 ms** |

---

## 2. Resource & Indexing Strategy

- Spans are indexed by `(project_id, trace_id, start_time)` allowing single-partition scans.
- Waterfall assembly uses an iterative $O(N)$ hash-map indexing pass rather than recursive searching to eliminate call-stack overflow risk.
