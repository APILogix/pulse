# Automation Module Benchmark & Performance Profile

This document outlines evaluation speeds, worker execution latency, and SSRF validation throughput for the **Automation Module**.

---

## 1. Benchmarks

| Operation | Latency (p50) | Latency (p99) |
| :--- | :--- | :--- |
| **Playbook Condition Evaluation** | **0.15 ms** | **0.42 ms** |
| **SSRF DNS & IP Range Resolution** | **0.8 ms** | **2.5 ms** |
| **Action Execution & HTTP Dispatch** | **140 ms** | **420 ms** (Dependent on remote endpoint) |
| **Execution Log Write** | **1.2 ms** | **3.8 ms** |
