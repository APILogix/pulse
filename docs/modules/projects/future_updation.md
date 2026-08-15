# Projects Module Future Updates & Roadmap

This document describes planned features, granular API scoping, and dynamic configuration streaming for the **Projects Module**.

---

## 1. Roadmap Items

1. **Scoped Fine-Grained API Tokens**: Support for scoped keys restricted to specific HTTP paths (e.g., `write:traces-only` or `read:analytics-only`).
2. **Real-Time SDK Config Streaming (WebSockets / SSE)**: Dynamic push notifications to active client SDKs when sampling rules or feature flags change in the UI.
3. **Environment Cloning & Branching**: Instant cloning of project environment configurations for CI/CD ephemeral testing branches.
