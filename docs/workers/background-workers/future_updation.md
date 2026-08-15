# Background Worker Tier Future Updates & Roadmap

This document outlines future scaling improvements and architectural upgrades for the **Background Worker Tier**.

---

## 1. Planned Roadmap

1. **Per-Queue Independent Worker Splitting**: Extract high-frequency queues (`alerting`, `ai`) into individual isolated container deployments.
2. **Dynamic Work Stealing & Prioritization**: Implement priority-weighted queue consumption to prioritize critical incident alerts over background session cleanups.
3. **Telemetry Partition Pre-Warming**: Pre-create future daily partitions 14 days in advance to eliminate runtime partition creation contention.
