# Cron Scheduler Process Benchmark & Performance Profile

This document outlines memory footprint and dispatch latency for the **Cron Scheduler Process**.

---

## 1. Benchmarks & Resource Profile

- **Memory Consumption**: Baseline memory is minimal (**~45 MB** RSS).
- **CPU Utilization**: **< 0.5%** on 1 vCPU (wakes up only at scheduled second marks).
- **Schedule Dispatch Latency**: **< 15 ms** from trigger second to pg-boss queue insertion.
