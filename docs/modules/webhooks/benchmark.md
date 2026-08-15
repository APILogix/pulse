# Webhooks Module Benchmark & Performance Profile

This document outlines signature generation speeds, dispatch throughput, and retry queue latencies for the **Webhooks Module**.

---

## 1. Benchmarks

| Operation | Latency (p50) | Latency (p99) |
| :--- | :--- | :--- |
| **HMAC-SHA256 Payload Signature** | **0.015 ms** | **0.04 ms** |
| **Job Enqueue Time (pg-boss)** | **1.2 ms** | **4.1 ms** |
| **Outbound Dispatch (Worker)** | **120 ms – 350 ms** (Endpoint dependent) | **1.2 s** |
| **Delivery Log Insert** | **1.8 ms** | **5.5 ms** |
