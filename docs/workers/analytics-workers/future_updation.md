# Analytics Worker Tier Future Updates & Roadmap

This document outlines upcoming performance optimizations and columnar aggregation offloading for the **Analytics Worker Tier**.

---

## 1. Planned Roadmap

1. **Native ClickHouse AggregatingMergeTree Integration**: Delegate multi-window rollups directly to ClickHouse background merge trees.
2. **Parallel Signal Worker Partitioning**: Multi-threaded worker execution using Node.js `worker_threads` for CPU-intensive HLL and DDSketch merges.
3. **Automated Partition Compaction & Clustering**: Automatic PostgreSQL cluster/reindex commands executed during low-traffic maintenance windows.
