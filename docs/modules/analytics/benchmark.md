# Analytics Module (v1) Benchmark & Performance Profile

This document outlines the performance, query execution timings, and caching throughput for the **Analytics Module (v1)**.

---

## 1. Query Latency & Cache Hit Benchmarks

| Metric / Scenario | Cache Hit (In-Memory LRU) | Database Query (Cold - 1M Rows) | Database Query (Cold - 10M Rows) |
| :--- | :--- | :--- | :--- |
| **p50 Response Time** | **1.2 ms** | **45 ms** | **185 ms** |
| **p95 Response Time** | **2.8 ms** | **120 ms** | **480 ms** |
| **p99 Response Time** | **5.1 ms** | **210 ms** | **950 ms** |
| **Throughput (QPS)** | **3,200 QPS** | **45 QPS** (DB connection bounded) | **12 QPS** |

---

## 2. Resource Overhead

- **Memory Footprint**: ~40 MB for LRU cache entries (up to 1,000 project query results).
- **PostgreSQL Connection Load**: Raw SQL queries use the primary or LogDB read pool with a 5-second statement timeout (`statement_timeout=5000`).
