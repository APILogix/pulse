# Database Operations, Migrations & Maintenance Runbook

This document describes migration workflows, partition maintenance, seeders, and index tuning scripts for **PostgreSQL** and **Log DB**.

---

## 1. Migration Profiles & Commands

Pulsiv maintains two distinct database schema sets:

### 1.1 Primary Database Migrations
Controls users, organizations, projects, API keys, billing, and alert rules.
```bash
# Run canonical migrations (Safe for Production)
npm run db:migrate:canonical

# Create fresh primary database schema
npm run db:create:primary

# Seed billing plan catalog (Free, Team, Enterprise)
npm run db:seed:billing

# Seed initial development data
npm run db:seed:primary
```

### 1.2 Log Database Migrations (Partitioned Telemetry)
Controls `events_*`, `spans_*`, `traces_*`, and `analytics_rollups_*`.
```bash
# Migrate Log DB tables and initial partition set
npm run db:migrate:logdb

# Reset Log DB tables (Development only)
npm run db:reset:logdb
```

---

## 2. Partition Maintenance & Retention Sweeps

1. **Daily Partitions**: Telemetry tables are partitioned by day: `events_errors_YYYY_MM_DD`.
2. **Automated Partition Creation**: Background workers run daily maintenance sweeps (`telemetry-maintenance.processor.ts`) to ensure partitions exist 7 days in advance.
3. **Data Retention Dropping**: Partitions older than the organization's retention policy (e.g. 30 days on Team tier) are dropped instantly using `DROP TABLE <partition_name>`, avoiding expensive row-by-row `DELETE` locks.

---

## 3. High-Performance Indexing Script

To optimize query latency across high-volume tables:
```bash
# Rebuild and apply optimized compound indexes
npm run db:indexes
```
