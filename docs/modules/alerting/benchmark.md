# Alerting Module Benchmark & Performance Profile

This document outlines evaluation throughput, rule execution latency, and dispatch performance for the **Alerting Module**.

---

## 1. Benchmarks

| Metric | Measured Value | Target SLA |
| :--- | :--- | :--- |
| **Rule Evaluation Throughput** | **1,200 rules/sec** | > 500 rules/sec |
| **Average Query Time per Rule** | **4.5 ms** (Log DB partition scan) | < 25 ms |
| **Notification Dispatch Latency** | **120 ms – 350 ms** (HTTP webhook dispatch) | < 1.0 s |
| **State Transition & Dedup Overhead** | **0.4 ms** | < 2 ms |
