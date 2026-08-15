# AI Module Future Updates & Roadmap

This document outlines upcoming AI capabilities, multi-model routing, and local embeddings storage for the **AI Module**.

---

## 1. Planned Roadmap

1. **Multi-Model Dynamic Routing**: Intelligently route simple queries to smaller, cost-effective models (e.g. Claude 3.5 Haiku / GPT-4o-mini) and complex system outages to frontier models (Claude 3.7 Sonnet / GPT-4o).
2. **Vector Embeddings for Historical Outages**: Store past resolved incidents in `pgvector` to instantly recall and suggest historical remediation solutions.
3. **Automated Pull Request Generation**: Generate unified diff patches and create GitHub / GitLab Pull Requests directly from the RCA UI.
