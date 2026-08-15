# Authentication Module Benchmark & Performance Profile

This document outlines the performance, hashing benchmarks, and session verification throughput of the **Authentication Module**.

---

## 1. Benchmarks & Crypto Operations

| Operation | CPU Cost / Round | Average Latency | Max Throughput (1 Core) |
| :--- | :--- | :--- | :--- |
| **Bcrypt Password Hash (Cost 12)** | ~250 ms CPU time | **245 ms** | ~4 ops/sec / core |
| **Passkey / WebAuthn Verification** | ECDSA P-256 signature | **1.8 ms** | ~550 ops/sec |
| **Session Cookie Signature Verify** | HMAC-SHA256 | **0.02 ms** | ~50,000 ops/sec |
| **JWT Token Decode & Verify** | RS256 / HS256 | **0.08 ms** | ~12,000 ops/sec |
| **Session Cache DB Lookup** | PostgreSQL Index Scan | **1.4 ms** | ~2,500 QPS |

---

## 2. Resource & Security Balance

- Password hashing is intentionally computationally expensive (`bcrypt` cost 12) to resist offline dictionary and rainbow table attacks.
- High-frequency authenticated API calls verify cached in-memory JWT/Session tokens rather than re-running password hashing.
