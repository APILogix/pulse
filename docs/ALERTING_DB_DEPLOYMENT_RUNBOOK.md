# Alerting — Database Deployment Runbook (v3.2.0)

How to apply every database change from the alerting workstream, in order, with
verification at each step.

**Read this first:** the code is already deployed-safe *without* the migration —
`persistIncident()` is wrapped in try/catch, so alerts still evaluate and deliver.
What you lose until the migration runs is incident recording. The monitor for that
state is `alert_incident_persist_failed_total`.

---

## 0. What actually needs to change

| # | Object | Database | Type |
|---|---|---|---|
| 1 | `alert_incident_status` (enum) | PRIMARY | new type |
| 2 | `alert_incidents` (table + 8 indexes) | PRIMARY | new table |
| 3 | `alert_incident_events` (table + 3 indexes) | PRIMARY | new table |

**Nothing else.** No column altered, no table dropped, no data migrated. Log DB is
untouched. `telemetry_outbox`, `pgboss.job`, and all `events_*` tables are untouched.

Source files:
```
src/db/postgres/primary_db_draft/09_alerting/001_create_alert_incidents.sql
src/db/postgres/primary_db_draft/09_alerting/002_create_alert_incident_events.sql
database/migrations/logdb/06_alert_runtime/009_drop_dead_alert_incidents.up.sql
```

> The `002_` prefix on the events file is **load-bearing**, not cosmetic. See §1.1.

---

## 1. Which script to run

The repo has several DB entrypoints. For this change the correct one is
**`db:primary:draft`**, which applies the `.sql` files of one `primary_db_draft`
subfolder in lexicographic order, each wrapped in its own transaction.

```bash
# 1. DRY RUN first — prints what would execute, changes nothing
npm run db:primary:draft -- --dir 09_alerting --dry-run

# 2. Apply
npm run db:primary:draft -- --dir 09_alerting
```

### Why not the others

| Script | Why not |
|---|---|
| `npm run db:migrate` (`scripts/setup-db.ts`) | ⚠️ **Will not find these files.** Its candidate directories (`canonical_schema`, `canonical_migrations_draft`, `canonical_migrations`, `migrations2`) no longer exist on disk, and `primary_db_draft` is not in the list. It exits with "No migrations directory found" unless you pass `--migrations-dir` explicitly. |
| `npm run db:create:primary` | Whole-schema bootstrap from `schema.sql`. Correct for a **fresh** database only (see §3). Do not run against a populated database. |
| `npm run db:migrate:logdb` | **Also required**, but for a separate cleanup step — see §1.2. It does not create anything this feature reads. |
| `npm run db:seed:primary` | Seeders, not schema. Separate concern (see §4). |

`db:primary:draft` is idempotent for this change: every statement uses
`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, and the enum is created
inside a guarded `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_type ...)` block. Running
it twice is safe.

> The folder contains ~45 other `.sql` files. Because they are all `IF NOT EXISTS`,
> re-running the folder does not disturb existing objects — it only creates the two
> missing tables. If you prefer to apply *only* the new files, run them directly:
> ```bash
> psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
>   -f src/db/postgres/primary_db_draft/09_alerting/001_create_alert_incidents.sql
> psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
>   -f src/db/postgres/primary_db_draft/09_alerting/002_create_alert_incident_events.sql
> ```
> Order matters: `alert_incident_events` has an FK to `alert_incidents`.

---

## 1.1. Fixed defect: `42P01 relation "alert_incidents" does not exist`

An earlier revision of this change shipped the events table as
`001_create_alert_incident_events.sql`. Applying the folder failed:

```
error: relation "alert_incidents" does not exist
  code: '42P01'
  at runSqlFile (scripts/run-primary-draft-folder.ts:188:5)
```

**Root cause — lexicographic filename ordering, not a SQL error.**
`run-primary-draft-folder.ts` sorts a folder's `.sql` files by filename. Comparing
the two original names character by character:

```
001_create_alert_incident_events.sql
001_create_alert_incidents.sql
                         ^
         '_' = 0x5F   vs   's' = 0x73
```

`_` sorts before `s`, so the **child table was created before its parent**, and its
`REFERENCES alert_incidents(id)` had nothing to point at.

**Fix.** The events file was renamed to `002_create_alert_incident_events.sql`. All
`001_*` files now apply first, guaranteeing the parent exists. The file carries a
header comment marking the prefix as load-bearing so it is not "tidied" back to
`001_`.

**Rule for this folder:** any table with an FK to another table in the same folder
must have a filename that sorts *after* its parent. Numeric prefix is the reliable
lever; do not rely on table names sorting favourably.

> **Pre-existing instance of the same hazard.**
> `001_create_alert_rule_bindings.sql` declares
> `rule_id UUID NOT NULL REFERENCES alert_rules(id)` and sorts *before*
> `001_create_alert_rules.sql` for exactly the same reason. It does not fail today
> because `alert_rules` already exists in every deployed database, so the FK
> resolves. It **will** fail on a genuinely empty database. This was found while
> diagnosing the above and is left unchanged — renaming it is out of scope for this
> change and fresh databases are built from `schema.sql` (§3), which orders
> correctly. Flagged here so it is not a surprise later.

---

## 1.2. Log DB migration (required, separate database)

Nothing this feature *reads* lives in the Log DB. The Log DB migration exists to
remove a dead, structurally-wrong `alert_incidents` table that predates this work.

```bash
npm run db:migrate:logdb
```

Applies `database/migrations/logdb/06_alert_runtime/009_drop_dead_alert_incidents.up.sql`,
which drops `alert_correlation_groups` (FK child) then `alert_incidents`.

**Why it must go rather than simply be ignored.** `IncidentsRepository` issues
*unqualified* `alert_incidents` SQL and is constructed with the primary pool. While
a same-named table exists in the Log DB, wiring the wrong pool in would resolve
silently against a table with no `project_id` and no status enum. Deleting it turns
a silent misconfiguration into an immediate loud failure. The Log DB copy is also
unusable for incidents on its own terms: it has no `project_id`, its
`UNIQUE (organization_id, fingerprint)` is **full** rather than partial so an
incident can never reopen after resolving, and it sits in a range-partitioned
schema that retention-prunes rows.

**It will not silently destroy data.** The migration opens with a `DO $$` guard that
counts both tables and `RAISE EXCEPTION`s if either is non-empty, rolling back the
transaction. Verified before writing it: zero code references to either table
resolve to the Log DB. If the guard does fire, the tables are not dead in your
environment — investigate before overriding.

Expected output on a clean run:

```
NOTICE:  Log DB alert_incidents / alert_correlation_groups confirmed empty - safe to drop.
```

Verify:

```sql
-- against the LOG DB
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('alert_incidents','alert_correlation_groups');
-- expect 0 rows

SELECT decision FROM logdb_schema_notes WHERE subject = 'alert_incident_ownership';
-- expect the ownership rationale
```

**Rollback:** `009_drop_dead_alert_incidents.down.sql` restores both tables to
their exact pre-009 shape (defects included — a down migration must reproduce the
previous state, not an improved one) and deletes the `logdb_schema_notes` row.
Schema only; it does not restore data.

`user_notification_preferences` also has zero code references but is a different
concern and is **deliberately left in place**.

---

## 2. Verification

Run after applying. All five checks must pass.

```sql
-- 1. Enum exists with exactly three values
SELECT enumlabel FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'alert_incident_status'
 ORDER BY e.enumsortorder;
-- expect: open, acknowledged, resolved

-- 2. Both tables exist
SELECT table_name FROM information_schema.tables
 WHERE table_name IN ('alert_incidents','alert_incident_events');
-- expect: 2 rows

-- 3. project_id exists and is a real FK (the explicit requirement)
SELECT column_name, is_nullable, data_type
  FROM information_schema.columns
 WHERE table_name = 'alert_incidents' AND column_name = 'project_id';
-- expect: project_id | YES | uuid

SELECT conname FROM pg_constraint
 WHERE conrelid = 'alert_incidents'::regclass AND contype = 'f';
-- expect FKs to organizations, projects, alert_rules, alert_rule_bindings, users

-- 4. THE CRITICAL ONE — active-uniqueness index must be PARTIAL
SELECT indexname, indexdef FROM pg_indexes
 WHERE tablename = 'alert_incidents' AND indexname = 'uq_alert_incident_active';
-- indexdef MUST contain:  WHERE ((status = ANY (ARRAY['open','acknowledged'])))
-- If it is NOT partial, recurrence is broken: a second incident can never open
-- after the first resolves.

-- 5. Index count
SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'alert_incidents';      -- expect 9 (8 + pkey)
SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'alert_incident_events'; -- expect 4 (3 + pkey)
```

### Functional smoke test

```sql
-- Prove active-uniqueness AND recurrence in one go.
-- Substitute a real organization_id.
BEGIN;
  INSERT INTO alert_incidents (organization_id, fingerprint, title, severity, status)
  VALUES ('<ORG_UUID>', 'smoke-test-fp', 'smoke', 'warning', 'open');

  -- must FAIL with unique_violation (one active per fingerprint)
  INSERT INTO alert_incidents (organization_id, fingerprint, title, severity, status)
  VALUES ('<ORG_UUID>', 'smoke-test-fp', 'smoke dup', 'warning', 'open');
ROLLBACK;

BEGIN;
  INSERT INTO alert_incidents (organization_id, fingerprint, title, severity, status)
  VALUES ('<ORG_UUID>', 'smoke-test-fp2', 'a', 'warning', 'open');
  UPDATE alert_incidents SET status='resolved', resolved_at=NOW()
   WHERE fingerprint='smoke-test-fp2';
  -- must SUCCEED (recurrence after resolve)
  INSERT INTO alert_incidents (organization_id, fingerprint, title, severity, status)
  VALUES ('<ORG_UUID>', 'smoke-test-fp2', 'b', 'warning', 'open');
ROLLBACK;
```

If the first block succeeds instead of failing, the partial index is missing or wrong
— stop and fix before enabling alert workers.

---

## 3. Fresh-database path

`npm run db:create:primary` executes `src/db/postgres/primary_db_draft/schema.sql`
wholesale. That file is a **generated baseline** and does not yet include the two new
tables, so a fresh database created from it will be missing them.

**Two options:**

**A. Simplest** — create from baseline, then apply the folder:
```bash
npm run db:create:primary
npm run db:primary:draft -- --dir 09_alerting
```

**B. Regenerate the baseline** so a single `db:create:primary` is sufficient. Append
both files' contents to `schema.sql` in the existing banner style, and add the enum
to the alerting `DO $$` block near the top:

```sql
-- ============================================================
-- Source: 09_alerting/001_create_alert_incidents.sql
-- ============================================================
```
Then add both tables to the inventory in
`src/db/postgres/primary_db_draft/SCHEMA_RECONCILIATION.md`.

> Option A is recommended. `schema.sql` regeneration is manual in this repo and is a
> separate change with its own review surface.

---

## 4. Deploy order

```
1. Apply PRIMARY migration  npm run db:primary:draft -- --dir 09_alerting --dry-run
                            npm run db:primary:draft -- --dir 09_alerting
2. Verify (§2)              all five checks + smoke test
3. Deploy backend           API + workers
4. Watch (§5)               alert_incident_persist_failed_total should stay flat
5. Deploy frontend          incident pages
6. Apply LOG DB cleanup     npm run db:migrate:logdb          (§1.2)
```

Step 6 is **last and independent**. It only drops dead schema, so it can run at any
point — or be deferred entirely — without affecting the feature. Running it last
means a rollback of steps 1–5 needs no Log DB action at all.

**Migration before code is safe** — the new tables are additive and unused by the
previous version. **Code before migration is also safe but degraded**: incident
persistence fails non-fatally, alerts still deliver, no incidents recorded.

### ⚠️ One-time consideration: in-flight alerts

Fingerprint values changed in this release (a single canonical `alertIdentityHash`
replaced two divergent implementations). Consequences at cutover:

- Alerts currently **firing** will not match their historical `alert_key`. They will
  be treated as new alerts, and their old `alert_event_state` rows will not receive
  recoveries.
- Because incidents key off the same fingerprint, those alerts open **fresh
  incidents** rather than continuing an existing one.

**Mitigation — pick one:**
- **Recommended:** deploy during a quiet window with no/few active alerts. Manually
  resolve any stragglers first.
- Or accept a one-time duplicate generation of alerts and resolve the orphaned
  `alert_event_state` rows afterwards.

No backfill script is provided; writing one requires deciding whether historical
alert continuity matters more than a clean cutover.

---

## 5. Post-deploy monitoring

| Metric | Healthy | Meaning if wrong |
|---|---|---|
| `alert_incident_persist_failed_total{operation="open"}` | **flat at 0** | Migration not applied, or FK/permission problem |
| `alert_incident_opened_total` | rises with real alerts | 0 while alerts fire ⇒ incidents not being created |
| `alert_incident_reused_total` | **>> opened** in steady state | If opened >> reused, dedup is failing (fingerprint cardinality regression) |
| `alert_evaluation_stale_total` | near 0 | Analytics rollup pipeline lagging |
| `alert_cooldown_blocked_total{gate="db-authoritative"}` | some traffic | If this carries *all* traffic, Redis is down (correctness unaffected) |

First smoke check after deploy:
```sql
SELECT status, COUNT(*) FROM alert_incidents GROUP BY status;
SELECT kind, COUNT(*) FROM alert_incident_events GROUP BY kind;
```

---

## 6. Rollback

Code rollback needs no DB change — the tables are additive and the previous version
ignores them.

If you must drop them (order matters, FK dependency):
```sql
DROP TABLE IF EXISTS alert_incident_events;   -- FK child first
DROP TABLE IF EXISTS alert_incidents;
DROP TYPE  IF EXISTS alert_incident_status;
```
This destroys incident history. There are no `.down.sql` files in
`primary_db_draft` — that tree has no down-migrations by convention.

---

## 7. Are alert rules correctly inserted in the DB?

Verified during this work — the answer is **yes**, with one design gate worth knowing.

**Seeding chain:**
```
Org provisioned
  → AlertingWorkspaceRepository.provision()          (alerting-workspace.repository.ts:112)
  → seedDefaultPresetsForOrgInTransaction()           (evaluator/presets.ts:633)
      ├─ INSERT INTO alert_rules            (46 presets, project_id = NULL, is_default = TRUE)
      ├─ INSERT INTO alert_rule_conditions  (field_path, operator, threshold, lookback, aggregate)
      └─ INSERT INTO alert_rule_actions     (notify → in_app, project_members)
```
The same seeder also runs from `project-policy.service.ts:180`. Presets are
additionally mirrored into `alerting_policy_catalog` / `alerting_policy_versions`
for the policy-catalog UI — that mirror is **not** what the evaluator reads.

**What the evaluator reads:** `AlertRuntimeRuleCatalog.listRulesForTier()` selects
from `alert_rules` + `alert_rule_conditions` + `alert_rule_bindings` — so it reads
exactly the seeded rows.

**The gate:** seeded presets are **organization-level** (`project_id = NULL`), and
`resolveRulesForScope()` enforces `requireProjectSubscription` for org-level rules.
A project therefore evaluates a preset only once it has an `alert_rule_bindings`
row — created by project subscription. This is deliberate (an org catalog rule
should not silently apply to every project), but **it is the first thing to check
if the analytics engine appears to evaluate nothing.**

```sql
-- Are presets seeded for this org?
SELECT COUNT(*) FROM alert_rules
 WHERE organization_id = '<ORG_UUID>' AND is_default = TRUE AND deleted_at IS NULL;
-- expect 46

-- Split by tier (which queue evaluates them)
SELECT evaluation_category, COUNT(*) FROM alert_rules
 WHERE organization_id = '<ORG_UUID>' AND deleted_at IS NULL
 GROUP BY evaluation_category;
-- expect ≈ fast 16, analytics 30

-- Do rules have conditions? A rule with none can never match.
SELECT r.preset_key FROM alert_rules r
  LEFT JOIN alert_rule_conditions c ON c.rule_id = r.id
 WHERE r.organization_id = '<ORG_UUID>' AND r.deleted_at IS NULL
 GROUP BY r.preset_key HAVING COUNT(c.id) = 0;
-- expect 0 rows

-- THE USUAL CULPRIT: is the project subscribed?
SELECT COUNT(*) FROM alert_rule_bindings
 WHERE organization_id = '<ORG_UUID>' AND project_id = '<PROJECT_UUID>'
   AND deleted_at IS NULL;
-- 0 ⇒ no org-level preset will evaluate for this project
```

### Tier-classification fix included in v3.2.0

An audit of all 46 presets found **12 whose field paths were unregistered** in
`TIER_FIELD_PREFIXES`. None were broken — `listRulesForTier` also matches
`evaluation_category`, which the presets set explicitly. But
`inferEvaluationCategory()` defaults an unregistered path to `'analytics'`, so a
**user-created** rule on one of those paths would be routed to the window tier,
whose rollup tables have no such column — `hasRelevantMetrics` would skip it and
the rule would **never fire, silently**.

Five fast-tier paths are now registered: `errors.rejection`, `span.timeout`,
`db.deadlock`, `eventloop.lag`, `telemetry.drops`.

The eight analytics-declared paths (`errors.count`, `logs.matches`,
`requests.inactivity_minutes`, `db.slow_queries`, `metrics.memory.leak`,
`metrics.gc.pause`, `deployment.new_errors`) are deliberately left unregistered:
`'analytics'` is already the default, so an unregistered analytics path routes
correctly anyway.

Two tests now guard this permanently in `test/unit/alerting-runtime-rule-catalog.test.ts`:
- **no preset field path may derive a tier that contradicts its declared category**
- **every fast-tier preset path must be registered** in `TIER_FIELD_PREFIXES.fast`

The old assertion (`toHaveLength(35)`) had gone stale as presets grew to 46 and was
failing while testing nothing useful. It is replaced with uniqueness + classification
integrity checks that do not break when a preset is added.

---

## 8. Quick reference

```bash
# Apply
npm run db:primary:draft -- --dir 09_alerting --dry-run
npm run db:primary:draft -- --dir 09_alerting

# Verify
psql "$DATABASE_URL" -c "\d+ alert_incidents"
psql "$DATABASE_URL" -c "SELECT indexdef FROM pg_indexes WHERE indexname='uq_alert_incident_active';"

# Fresh DB
npm run db:create:primary && npm run db:primary:draft -- --dir 09_alerting

# Rollback (destroys incident history)
psql "$DATABASE_URL" -c "DROP TABLE IF EXISTS alert_incident_events; DROP TABLE IF EXISTS alert_incidents; DROP TYPE IF EXISTS alert_incident_status;"
```
