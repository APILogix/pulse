# Log DB Organization Lookup Sync Workflow

## What Was Implemented

`organization_lookup` is now maintained as a best-effort Log DB snapshot after primary DB organization and billing changes.

Implemented code:

- `src/shared/logdb/lookup-sync.ts`
  - Reads source-of-truth organization/billing data from the primary DB pool.
  - Upserts `organization_lookup` through the Log DB primary pool.
  - Logs sync success/failure.
  - Provides a best-effort wrapper so product writes are never rolled back by Log DB availability.

- `src/modules/organization/core/core.service.ts`
  - Syncs Log DB lookup after organization creation.
  - Syncs after organization update.
  - Syncs after delete/archive/restore state changes.

- `src/modules/billing/subscriptions/service.ts`
  - Syncs after subscription creation.
  - Syncs after plan change.
  - Syncs after scheduled change metadata is saved.
  - Syncs after cancellation is scheduled.

## Pool Usage

Primary DB source query:

- Uses `pool` from `src/config/database.ts`.
- Reads:
  - `organizations`
  - `organization_subscriptions`
  - `plans`

Log DB destination query:

- Uses `logDB.queryWithRetry()` from `src/config/log-database.ts`.
- Passes `{ operation: 'write' }`, so the write always uses the Log DB primary pool.
- Writes:
  - `organization_lookup`

No Log DB write uses the primary DB pool.
No primary DB source query uses the Log DB pool.

## Runtime Flow

Organization create:

1. Primary DB transaction creates the organization.
2. Primary DB transaction provisions the free/trial subscription.
3. Primary DB transaction creates usage period and audit rows.
4. Transaction commits.
5. `syncOrganizationLookupToLogDbBestEffort(orgId, "organization.created")` runs asynchronously.
6. Log DB `organization_lookup` is inserted/updated with org identity and plan snapshot.

Billing plan change:

1. Primary DB transaction locks active subscription.
2. Primary DB updates `organization_subscriptions`.
3. Primary DB updates `organization_usage_current_period`.
4. Primary DB writes `subscription_events`.
5. Transaction commits.
6. `syncOrganizationLookupToLogDbBestEffort(orgId, "subscription.plan_changed")` runs asynchronously.
7. Log DB `organization_lookup.plan_key` and billing metadata are refreshed.

Failure behavior:

- If the primary DB transaction fails, no Log DB sync is attempted.
- If Log DB sync fails, the primary action remains committed.
- The failure is logged with `organizationId` and `reason`.
- The next org/billing mutation will retry the snapshot naturally.

## Data Written To Log DB

`organization_lookup` columns:

- `organization_id`
- `name`
- `slug`
- `plan_key`
- `metadata`
- `synced_at`

`metadata` contains:

- org `status`
- org `deletedAt`
- plan `id`, `key`, `name`, `tier`
- subscription `id`, `status`, `currentPeriodStart`, `currentPeriodEnd`
- sync `reason`
- source marker: `primary_db`

## Architecture Rule

Primary DB remains the source of truth for billing and entitlements. Log DB lookup tables are denormalized analytics snapshots only.

Ingestion should continue resolving plan tier from primary DB/cache during API-key resolution and pass `planTier` in queue metadata. Workers use that metadata for priority/fairness and write telemetry into Log DB.
