# Cron Scheduler Process Working & Operational Guide

This document describes cron schedule expressions, job registration patterns, and process management for the **Cron Scheduler Process**.

---

## 1. Schedule Registry

| Cron Schedule | Target Queue / Job Name | Purpose |
| :--- | :--- | :--- |
| `0 2 * * *` (Daily @ 02:00) | `org-cleanup-cron` | Prunes expired invitations, deleted organization workspaces. |
| `0 * * * *` (Hourly) | `auth-cleanup-cron` | Purges expired user sessions and stale CSRF tokens. |
| `0 */6 * * *` (Every 6h) | `billing-usage-sync` | Synchronizes staged event counters with Stripe subscription items. |
| `0 4 * * *` (Daily @ 04:00) | `telemetry-maintenance-cron` | Drops out-of-retention telemetry partitions and vacuum analyzes. |
| `*/15 * * * *` (Every 15m) | `connector-health-check` | Tests active Slack / PagerDuty webhook connections. |

---

## 2. Process Management

```bash
# Run locally
npm run dev:cron

# Run in production
npm run start:cron
```
