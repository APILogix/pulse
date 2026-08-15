# User Account Module Benchmark & Performance Profile

This document outlines performance metrics for user profile lookups and background export jobs in the **User Account Module**.

---

## 1. Benchmarks

| Operation | Latency (p50) | Latency (p95) |
| :--- | :--- | :--- |
| **Profile & Settings Lookup** | **1.1 ms** | **3.8 ms** |
| **Session Revocation** | **2.4 ms** | **6.5 ms** |
| **Personal Access Token Verify** | **0.08 ms** | **0.25 ms** |
| **GDPR Export Worker Job (10k items)** | **850 ms** | **2.1 s** |
