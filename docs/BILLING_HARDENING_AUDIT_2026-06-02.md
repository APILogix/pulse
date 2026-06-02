# Billing Hardening Audit (2026-06-02)

## Scope

This audit validates the new billing hardening work completed in this session:

- Migration-driven billing schema foundation
- Billing scheduler/cron execution
- Ingestion-to-billing real-time metering
- Ingestion quota enforcement with grace-mode policy
- Quota regression tests

## Production Smoke Steps Executed

1. Ran database migrations in development runtime:
   - Command: `npm run db:migrate` (with `NODE_ENV=development`)
   - Result: success
   - Applied files included:
     - `010_auth_phase3.sql` through `014_auth_phase7.sql`
     - `015_billing_core.sql`
     - `016_billing_invoices.sql`
     - `017_billing_usage.sql`
     - `018_billing_coupons_quota.sql`
     - `019_billing_ops.sql`

2. Started workers:
   - Command: `npm run dev:workers` (with `NODE_ENV=development`)
   - Result: worker process started and reported active workers including billing scheduler

3. Verified billing scheduler execution from database:
   - Script: `scripts/billing-smoke-check.mjs`
   - Result:
     - `billing_job_runs_count`: 4
     - `billing_webhook_events_count`: 0
     - `usage_counters_count`: 0
   - Recent successful jobs recorded:
     - `invoice-cycle`
     - `dunning`
     - `usage-rollup`
     - `webhook-reconciliation`

4. Started API service:
   - Command: `npm run dev` (with `NODE_ENV=development`)
   - Result: server started and module registration completed, including billing schema verification + plan seeding

5. Called ingestion health endpoint:
   - Request: `GET /api/v1/health`
   - Response: healthy (`redis=true`, `database=true`, `queue=true`)

6. Ran quota regression tests:
   - Command: `npm test -- src/modules/ingestion/service.quota.test.ts` (with `NODE_ENV=development`)
   - Result: 2 passing tests

7. TypeScript build verification:
   - Command: `npm run build`
   - Result: success

## Key Evidence Summary

- Billing schema now runs through migration ledger and applies successfully.
- Billing scheduler creates run records in `billing_job_runs` and marks them succeeded.
- API startup enforces billing schema readiness and seeds plans.
- Ingestion path includes quota rejection with structured details.
- Quota behavior has direct test coverage for allow + block scenarios.

## Known Blockers / Gaps

1. End-to-end quota boundary ingest using live HTTP endpoint could not be fully executed because:
   - ingestion API requires a plaintext project API key
   - database stores only hashed key material, and no plaintext SDK key is retrievable from DB
2. `billing_webhook_events` table currently has zero rows in this environment, so reconciliation behavior was validated as scheduler execution, not provider-event replay processing.
3. `usage_counters_count` is zero in current environment baseline, indicating no seeded/org traffic for live metering boundary demonstration.

## Recommended Next Validation

1. Create a disposable test org + project API key through the app flow (or admin script that emits plaintext key once).
2. Send controlled ingestion batches:
   - below quota (expect accepted)
   - at/over quota (expect `402` with `QUOTA_EXCEEDED` and details)
3. Verify DB deltas:
   - `organization_usage_counters` increments during accepted traffic
   - no increments for rejected quota requests
4. Seed one test webhook event row and verify reconciliation status transitions and retry count increments.

## Files Added for Audit/Validation

- `scripts/billing-smoke-check.mjs`
- `docs/BILLING_HARDENING_AUDIT_2026-06-02.md`
