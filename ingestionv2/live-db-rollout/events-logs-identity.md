# Live Log DB rollout: `events_logs` scoped identity

## Rollout status

**UNVERIFIED:** This procedure was not executed. Migration 030 is present only in the working tree unless deployment evidence proves otherwise.

**MEASURED:** The forward migration creates `idx_events_logs_event_unique` on `(organization_id, project_id, environment, event_id, occurred_at)` and contains no telemetry delete.

**MEASURED:** The rollback drops only that index and its exact ledger row, preserving `idx_events_logs_event`, public-ID objects, outbox objects, and telemetry rows.

**MEASURED:** Repository forward and rollback commands now share a fail-fast session advisory lock. Source/unit evidence does not substitute for a concurrent-command clone rehearsal.

**MEASURED:** Migration 030 is marked `codex-logdb-migration: requires-operator-drain`. Ingestion-worker startup uses automatic mode and defers the pending file without executing its duplicate scan/index DDL or inserting its ledger row; startup continues with a warning. The explicit CLI remains operator mode and still enforces every gate below.

**MEASURED:** Production launchers execute compiled `dist` output. Build and deploy the fixed source before restarting workers; seeing the original fatal `55000` during normal startup indicates the old build or an operator-mode invocation is still running.

## Pending-migration startup state

While 030 is pending, normal worker startup is allowed but the five-column log retry guard is still absent. Expect a deferral warning on each startup. Do not set `pulse.events_logs_identity_drain_confirmed=on` globally or on the worker process: the setting is only for the explicit migration session after writers have actually been drained.

The pending warning is resolved only when this guide's preflight/apply/validation sequence succeeds and the exact filename appears in `logdb_migrations`.

## Hard preconditions

Do not proceed until all are true:

1. Change approval names an operator, DBA reviewer, application owner, rollback owner, and maintenance window.
2. A current backup/snapshot and restore test are confirmed.
3. The direct `LOG_DB_PRIMARY` endpoint is identified; do not use a transaction-pooling endpoint.
4. Deployed application revision and migration ledger are captured.
5. All API producers, ingestion workers, replayers, scripts, and direct SQL writers are stopped or blocked.
6. Active/idle-in-transaction writers are zero and remain zero through validation.
7. Current partition/index topology and disk headroom are captured.
8. Exact five-column duplicate groups are zero.
9. Null-project policy is reviewed.
10. Public-ID defaults/sequences/triggers and outbox contracts are captured before change.
11. No uncoordinated migration/direct-SQL command is running; repository apply and rollback tooling must retain the shared lock for the complete operation.
12. Concurrent apply/rollback rejection and forward/down/forward convergence were rehearsed on a production-sized clone.

**MEASURED:** Setting `pulse.events_logs_identity_drain_confirmed=on` is only an assertion. It does not stop writers.

## Step 1: identify target and topology

Run on the direct Log DB session:

```sql
SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), pg_is_in_recovery(), version();

SELECT
  parent.relname AS parent_table,
  child.relname AS child_table
FROM pg_inherits
JOIN pg_class parent ON parent.oid = inhparent
JOIN pg_class child ON child.oid = inhrelid
WHERE parent.oid = 'public.events_logs'::regclass
ORDER BY child.relname;

SELECT
  i.indexrelid::regclass AS index_name,
  i.indisunique,
  i.indisvalid,
  i.indisready,
  pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
WHERE i.indrelid = 'public.events_logs'::regclass
ORDER BY 1;
```

Reject the rollout if a same-named `idx_events_logs_event_unique` exists with an unexpected definition or invalid state. `IF NOT EXISTS` checks a name, not semantic equivalence.

## Step 2: prove writer drain

Use the deployment's approved ingress maintenance mechanism, then stop/drain ingestion workers. Verify on Log DB:

```sql
SELECT
  pid,
  application_name,
  state,
  wait_event_type,
  wait_event,
  xact_start,
  query_start,
  left(query, 240) AS query_sample
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
ORDER BY xact_start NULLS LAST, query_start;
```

Review every remaining session. Do not infer “drained” from queue depth alone.

## Step 3: exact duplicate and null preflight

### Correct migration identity

```sql
WITH duplicate_groups AS (
  SELECT
    organization_id,
    project_id,
    environment,
    event_id,
    occurred_at,
    COUNT(*)::bigint AS group_size
  FROM events_logs
  GROUP BY
    organization_id,
    project_id,
    environment,
    event_id,
    occurred_at
  HAVING COUNT(*) > 1
)
SELECT
  COUNT(*)::bigint AS duplicate_groups,
  COALESCE(SUM(group_size - 1), 0)::bigint AS surplus_rows
FROM duplicate_groups;

SELECT COUNT(*)::bigint AS null_project_rows
FROM events_logs
WHERE project_id IS NULL;
```

Required result: exact five-column `duplicate_groups=0` and `surplus_rows=0`, or stop.

### Evidence distinction

| Classification | Grouping | Known result |
| --- | --- | --- |
| **MEASURED** | Broad `(organization_id,event_id,occurred_at)` | 643 groups, 5,057 surplus rows in the forensic session. |
| **UNKNOWN** | Correct five-column identity | Not captured. Must be measured now. |

**DERIVED:** Never use 643/5,057 as the migration-scoped count; project/environment differences can make broad collisions legitimate.

## Step 4: non-destructive duplicate workflow

If exact duplicates exist, stop the rollout. Do not delete automatically.

1. Export the complete rows for each exact duplicate group to immutable, access-controlled storage.
2. Record query, target identity, timestamp, row count, checksum, owner, and retention policy.
3. Classify whether rows are byte-equivalent or contain conflicting telemetry.
4. Determine authoritative-row policy with product/data/compliance owners.
5. Rehearse remediation and restore in a clone.
6. Obtain explicit approval for a separate remediation change.
7. Re-run exact counts and row-count reconciliation while writers remain drained.

No executable `DELETE` is supplied by this runbook because telemetry remediation is data-specific and irreversible without a proven archive/restore path.

## Step 5: forward dry-run with control-plane effects

```powershell
npm run db:migrate:logdb -- --dry-run --only 03_observability_v2/030_events_logs_idempotency.up.sql
```

**MEASURED:** Forward dry-run discovers and filters files, then checks out a Log DB client and attempts the shared fail-fast advisory lock. It may create `logdb_migrations` with `CREATE TABLE IF NOT EXISTS` and queries that ledger to determine whether the selected file is already applied.

**MEASURED:** Dry-run does not execute migration 030's file SQL. It therefore skips the drain GUC assertion, exact duplicate scan, `SET LOCAL lock_timeout`, index DDL, and ledger insert.

**MEASURED:** If another repository forward/rollback command holds the key, `pg_try_advisory_lock` fails immediately with `Another Log DB migration or rollback already holds the migration lock`. The migration-local five-second relation-lock timeout does not govern this earlier step.

**UNVERIFIED:** Dry-run behavior is source/static evidence only; it was not run against the live target in this work.

## Step 6: apply in the drained window

PowerShell session example:

```powershell
$env:PGOPTIONS = "-c pulse.events_logs_identity_drain_confirmed=on"
npm run db:migrate:logdb -- --only 03_observability_v2/030_events_logs_idempotency.up.sql
Remove-Item Env:PGOPTIONS
```

**UNVERIFIED:** Confirm in a staging clone that the installed `pg`/connection path propagates `PGOPTIONS` to the same migration session. If not, place the equivalent `options=-c ...` on a temporary direct migration connection string. Never persist this assertion in the normal application DSN.

**MEASURED:** Runner and migration behavior on a populated table:

1. Discover/filter the file and check out one client.
2. Acquire the shared advisory lock with `pg_try_advisory_lock`; fail rather than wait on contention.
3. Ensure/query the migration ledger.
4. Execute migration SQL, beginning with `SET LOCAL lock_timeout='5s'` inside its transaction.
5. Require the drain GUC or raise SQLSTATE `55000` before scan/DDL.
6. Scan exact five-column duplicates.
7. Raise SQLSTATE `23505` if any exact group exists.
8. Create the partitioned unique parent/children and commit.
9. Record the exact ledger filename while the shared advisory lock is still held.
10. Release the advisory lock in `finally` and release the client.

**DERIVED:** The five-second setting bounds relation-lock waiting inside migration SQL, not total index-build time after locks are acquired. The advisory lock itself is fail-fast, not five-second bounded.

## Step 7: post-apply validation before resume

```sql
SELECT filename, applied_at, duration_ms
FROM logdb_migrations
WHERE filename = '03_observability_v2/030_events_logs_idempotency.up.sql';

SELECT
  i.indexrelid::regclass AS index_name,
  i.indisunique,
  i.indisvalid,
  i.indisready,
  pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
WHERE i.indexrelid = 'public.idx_events_logs_event_unique'::regclass;

SELECT to_regclass('public.idx_events_logs_event') AS retained_lookup_index;
```

Also verify:

1. Every current leaf, including default, has a valid attached matching unique index.
2. Exact five-column duplicates remain zero.
3. Before/after telemetry row counts match.
4. `idx_events_logs_event` remains.
5. Public-ID defaults, sequences, function, enabled triggers, and lookup indexes remain.
6. Outbox parent/default/indexes remain.
7. No unexpected blocked sessions or invalid indexes exist.
8. Application smoke test writes one log and retries the same payload without creating a second row.

Only then resume workers and producers gradually. Monitor insert/conflict/error/lock/queue metrics.

## Failure handling

| Classification | Failure | Interpretation | Action |
| --- | --- | --- | --- |
| **MEASURED** | Shared advisory lock error | Another repository apply/rollback command holds the migration key. | Do not bypass it. Identify the command and inspect index/ledger state before retry. |
| **MEASURED** | SQLSTATE `55000` | Drain assertion absent on populated table. | Leave unapplied; establish real drain; retry only in approved window. |
| **MEASURED** | SQLSTATE `23505` | Exact scoped duplicates exist. | Leave unapplied; archive/investigate; no delete. |
| **MEASURED** | relation lock timeout | Required DDL lock not acquired within five seconds. | Identify blocker; keep drain; do not increase timeout blindly. |
| **DERIVED** | process fails after DDL transaction but before ledger insert | Index may exist without ledger row; a concurrent repository rollback could not interleave while the failed session held the shared lock, but crash cleanup releases that lock. | Inspect index definition/state and ledger manually before any retry. |
| **DERIVED** | malformed same-name index | `IF NOT EXISTS` can hide mismatch. | Stop; repair only under separate DBA-reviewed procedure. |

## Rollback

Rollback weakens log retry deduplication. Use only for confirmed incompatibility after approval and while writers remain drained.

### Dry-run

```powershell
npx tsx scripts/logdb-rollback.ts 03_observability_v2/030_events_logs_idempotency.down.sql --dry-run
```

**MEASURED:** Rollback dry-run reads the down file, opens one client, acquires the same fail-fast advisory lock, and queries `current_database()` for target display. It prints SQL size but executes no down SQL, drain assertion, index DDL, or ledger delete.

### Approved live rollback

```powershell
$env:PGOPTIONS = "-c pulse.events_logs_identity_drain_confirmed=on"
npx tsx scripts/logdb-rollback.ts 03_observability_v2/030_events_logs_idempotency.down.sql --yes
Remove-Item Env:PGOPTIONS
```

**MEASURED:** The rollback tool keeps one checked-out client for shared lock acquisition, target query, down SQL, unlock, and release. It no longer exits from inside the protected block when confirmation is absent; refusal throws and still reaches `finally`.

Post-rollback verify:

1. `idx_events_logs_event_unique` is absent from parent and leaves.
2. `idx_events_logs_event` remains.
3. Only the exact 030 ledger row is absent.
4. Telemetry row counts are unchanged.
5. Public-ID and outbox contracts are unchanged.
6. Application behavior is stable before writers resume.

**MEASURED:** The down file uses the same populated-table drain assertion and five-second relation-lock wait. It contains no telemetry delete.

### Required concurrency rehearsal

**UNVERIFIED:** Before production, hold the shared key in one clone command and prove a concurrent forward or rollback command fails fast without executing SQL or changing the ledger. Then prove forward/down/forward convergence and capture index, ledger, trigger, outbox, and row-count evidence. Focused helper/static tests are not a substitute.

## Optional leaf-by-leaf concurrent alternative

**UNVERIFIED:** This is not implemented or tested by repository tooling. It requires DBA validation on the exact PostgreSQL version in a production clone and a separate ledger strategy.

1. Perform all preflights above and freeze partition creation.
2. Outside a transaction, build a matching unique index concurrently on every leaf:

```sql
CREATE UNIQUE INDEX CONCURRENTLY <leaf_identity_index>
ON <leaf_table>
  (organization_id, project_id, environment, event_id, occurred_at);
```

3. Create the matching partitioned parent without recursively building children:

```sql
CREATE UNIQUE INDEX idx_events_logs_event_unique
ON ONLY events_logs
  (organization_id, project_id, environment, event_id, occurred_at);
```

4. Attach each leaf:

```sql
ALTER INDEX idx_events_logs_event_unique
ATTACH PARTITION <leaf_identity_index>;
```

5. Verify every leaf attachment and final parent validity.
6. Define how every future partition receives/attaches its index before accepting writes.
7. Define invalid-concurrent-index cleanup and rollback.

**DERIVED:** This can reduce long blocking builds but does not eliminate parent/attach locks, duplicate races, partition races, or operator complexity. Do not mark migration 030 applied merely because an equivalent-looking parent index exists.


## Phase-21 change record

1. **What changed:** the proposed forward change adds `idx_events_logs_event_unique` over organization/project/environment/event ID/occurrence time; it preserves the existing non-unique lookup and all telemetry.
2. **Why:** the active writer uses `ON CONFLICT DO NOTHING`, but the audited Log DB has no deployed scoped unique log identity guard. Stable retry inputs alone cannot suppress a duplicate without a matching constraint.
3. **Exact SQL migration:** [`030_events_logs_idempotency.up.sql`](../../database/migrations/logdb/03_observability_v2/030_events_logs_idempotency.up.sql) is authoritative, including transaction, 5-second relation-lock wait, real-drain assertion, scoped duplicate preflight, and parent unique-index DDL.
4. **Rollback SQL:** [`030_events_logs_idempotency.down.sql`](../../database/migrations/logdb/03_observability_v2/030_events_logs_idempotency.down.sql) is authoritative; it requires the same drain assertion, drops only the proposed guard, and removes the exact ledger row.
5. **Preconditions:** the twelve hard preconditions above are mandatory, especially disposable clone rehearsal, real writer drain, zero scoped duplicates, topology capture, backup/restore proof, and shared-lock serialization.
6. **Production execution order:** identify target/topology → drain/verify writers → duplicate/NULL preflight → forward dry-run → apply under drain assertion/shared lock → validate catalog/data/contracts → gradual resume/monitor.
7. **Lock implications:** parent index creation/drop is non-concurrent; relation-lock wait is capped at five seconds only after migration SQL starts. Build runtime after lock acquisition is not capped. The repository advisory lock is separate and fail-fast.
8. **Expected runtime impact:** **UNKNOWN.** Table/index build time, lock duration after acquisition, disk/WAL/CPU, and post-deployment insert cost were not measured on a production-sized clone. No improvement claim is authorized.
9. **Verification SQL:** target/topology, active-writer, exact-duplicate/NULL, index validity/definition, ledger, retained-index, row-count, trigger/public-ID, and outbox queries are provided above.
10. **Post-migration validation:** verify every leaf attachment/validity, zero exact duplicates, unchanged telemetry counts, retained lookup/public-ID/outbox contracts, no blockers/invalid indexes, and one write+retry smoke test before resuming.
11. **Failure recovery:** use the failure table and reviewed down migration; never bypass the shared lock, auto-delete duplicates, or roll back without writers drained. Inspect index+ledger state after any process failure before retry.

**Disposition:** this is documentation for a future approved operation. Neither SQL file was executed in this audit.
