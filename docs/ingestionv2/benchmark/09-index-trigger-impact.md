# 09 — Index/trigger impact

# NOT MEASURED / scaffolded but not executed

No index/trigger A/B benchmark has been run. Scaffolding exists and is ready to run once an isolated benchmark schema (e.g. a Neon branch) is available.

## What is scaffolded

| Component | File | Status |
| --- | --- | --- |
| Public-ID mechanism observer | [`scripts/bench/observe-public-id-mechanism.ts`](../../../scripts/bench/observe-public-id-mechanism.ts) | **Safe to run against any target right now** (read-only). Not run in this session — no reachable target. |
| Index/trigger A/B orchestrator | [`scripts/bench/index-trigger-ab.ts`](../../../scripts/bench/index-trigger-ab.ts) | Built; refuses to run without `--confirm-isolated-schema` and a non-production-looking `current_database()`. Not run — requires a variant SQL file, none exists yet. |
| Variant SQL files | `scripts/bench/schema-variants/*.up.sql` / `*.down.sql` | **None exist.** See rationale below. |

## Public-ID mechanism (documented from the prior audit, re-affirmed, not re-verified live this session)

The prior correctness audit established, from live catalog queries at that time: all ten typed tables have a `NOT NULL` sequence-backed `DEFAULT nextval(...)` on `public_id`, plus a shared `BEFORE INSERT OR UPDATE` trigger (`trg_sync_typed_event_contract`, defined across `999_typed_event_contract.sql`, `022_public_ids_and_trigger_guarantee.sql`, `023_fix_error_groups_trigger_contract.sql`, `026_fast_typed_event_contract.sql`). PostgreSQL evaluates the column default before the trigger fires, so an ordinary insert that omits `public_id` consumes the sequence default; the trigger only allocates a second value for an explicit NULL/empty ID and otherwise repairs timestamp/metadata/payload fields.

This session did **not** re-run that query against a live target. Run `observe-public-id-mechanism.ts` before trusting this description for capacity/planning purposes, since schema state can drift.

## Why no variant SQL exists yet

The prior audit recorded six *duplicate index signatures* (e.g. `events_errors` has a semantically redundant organization/project/environment/time index alongside its unique guard) but did not capture the exact second index's name/definition. Per the master prompt's non-negotiable rule against deleting an index without query-usage evidence, and against guessing at DDL, no `.up.sql`/`.down.sql` pair has been authored. See [`scripts/bench/schema-variants/README.md`](../../../scripts/bench/schema-variants/README.md) for the exact procedure to author one safely once an isolated target exists.

## What running this will produce, once executed

`index-trigger-ab.ts` reports, side by side for variant A (current schema) and variant B (candidate schema): INSERT/COMMIT latency and throughput from the direct-DB writer microbenchmark (explicitly labeled a DATABASE-ONLY MICROBENCHMARK in that output, per spec §30), plus before/after index and trigger catalog state. A removal recommendation requires this benchmark **and** a separate bounded `pg_stat_user_indexes` usage-window analysis — neither exists yet.

## Related documents

- [Database capacity](06-database-capacity.md)
- [Schema variants README](../../../scripts/bench/schema-variants/README.md)
- [Tooling classification](01-tooling-classification.md)
