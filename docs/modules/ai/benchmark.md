# AI Module Benchmark & Performance Profile

This document outlines latency profiles, context assembly timings, and token cost metrics for the **AI Module**.

---

## 1. Benchmarks

| Operation | Average Latency | p95 Latency | Notes |
| :--- | :--- | :--- | :--- |
| **Context Assembly (Traces + Logs)** | **24 ms** | **65 ms** | Parallel async DB queries |
| **PII & Secret Scrubbing** | **0.8 ms** | **2.2 ms** | In-memory regex stream scanning |
| **LLM Time-To-First-Token (TTFT)** | **420 ms** | **950 ms** | Dependent on OpenAI / LLM API |
| **Full RCA Completion** | **2.8 s** | **5.4 s** | Average completion: 600 tokens |
