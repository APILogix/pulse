# Event Analytics Module Benchmark & Performance Profile

This document details query execution benchmarks for custom event filtering and funnel calculations in the **Event Analytics Module**.

---

## 1. Benchmarks

| Query Type | 100k Events | 1M Events | 10M Events (Partitioned) |
| :--- | :--- | :--- | :--- |
| **Property Filter Query** | 12 ms | 48 ms | 180 ms |
| **3-Step Funnel Analysis** | 28 ms | 115 ms | 420 ms |
| **7-Day Cohort Retention Matrix** | 35 ms | 160 ms | 680 ms |
| **CSV Streaming (100k Rows)** | 420 ms | 1.8 s | 14.5 s |
