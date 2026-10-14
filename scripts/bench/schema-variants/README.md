# Schema variants for index/trigger A/B benchmarking

Status: **no variant files exist yet.** `scripts/bench/index-trigger-ab.ts` is ready to run, but running it requires a `<name>.up.sql` / `<name>.down.sql` pair in this directory, and none has been authored.

## Why no variant exists yet

The prior ingestion audit (`ingestionv2/database/index-forensics.md`) recorded that six *duplicate index signatures* exist (e.g. `events_errors` has a semantic duplicate of its organization/project/environment/time signature) but did **not** capture the exact second `CREATE INDEX ... ON ...` statement for each duplicate — only the identity of the unique guard it collides with. Authoring a `.down.sql` that drops a specific named index requires the exact index name and definition from `pg_indexes` on the actual target, not a guess from a signature description.

Per the master prompt's non-negotiable rule: *"DO NOT DELETE AN INDEX WITHOUT QUERY-USAGE/NECESSITY ANALYSIS"* and *"never remove an index merely because it slows INSERTs."* Guessing at DDL here would violate that rule twice over — once by inventing untested SQL, and once by proposing removal without the required analysis.

## How to safely author a variant, once an isolated target exists

1. Provision the isolated Neon branch (or clone) that will host the A/B test.
2. Run the read-only catalog query against it:
   ```sql
   SELECT indexname, indexdef FROM pg_indexes
   WHERE schemaname = 'public' AND tablename LIKE 'events_%'
   ORDER BY tablename, indexname;
   ```
3. Identify the exact duplicate pair by comparing `indexdef` column lists, confirming the signature reported in `index-forensics.md` still holds on that target's actual catalog (it may have changed since the audit snapshot).
4. Write `remove-duplicate-<table>-index.up.sql` containing exactly:
   ```sql
   DROP INDEX CONCURRENTLY IF EXISTS <exact_duplicate_index_name>;
   ```
5. Write the matching `.down.sql` containing the exact `CREATE INDEX` statement captured in step 2 (not reconstructed from memory), so a revert restores the identical index.
6. Get the pair reviewed like any other migration before running `index-trigger-ab.ts` against it.

## What is scaffolded and ready

- `scripts/bench/index-trigger-ab.ts` — orchestration (baseline capture, variant A benchmark, apply variant B, benchmark, revert, report). Refuses to run against anything not explicitly confirmed isolated.
- `scripts/bench/observe-public-id-mechanism.ts` — read-only, already safe to run against any target; documents whether public-ID generation is `DEFAULT nextval(...)`, trigger, trigger+sequence, or another mechanism, without proposing any change.
