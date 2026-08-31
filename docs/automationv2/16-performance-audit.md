# 16 — Performance Audit

No `EXPLAIN` was run in this audit (would require executing representative queries against production-scale data, which was out of scope and unsafe to do against the live database beyond the one read-only schema-introspection query used to confirm doc 08's P0 finding). All statements below are qualitative, based on code reading, not benchmarked.

## N+1 / per-event query risk

- Automation `processInbox()`: for each claimed inbox event (batch), the code calls `findMatchingWorkflows` (1 query), then for each matching workflow, `getActiveVersion` + version-bound conditions/actions (additional queries per workflow), then the cooldown/rate-limit gate (2 more queries) inside a transaction. For a batch of N events each matching M workflows, this is roughly O(N × M) query round-trips, not a single batched query. This is a plausible per-event cost concern at high event volume, consistent with the backpressure gap already flagged in doc 13. **Not benchmarked, flagged as a candidate for investigation only.**
- Alerting fast tier: per the already-existing `ALERT_RULE_CORRECTNESS_AUDIT.md` (not re-derived), the evaluator is shared and rules are matched per event; that audit did not flag N+1 issues as a concern, so this audit defers to it.

## Synchronous external calls on a critical path

- Automation and alerting action/notification execution both happen inside worker processes (not inline with ingestion or the API request/response cycle) — confirmed by the process topology in doc 02. This is correct: neither subsystem's slow external calls (webhook timeouts, email sends) can block a user-facing API request, because they're dispatched asynchronously via pg-boss.

## JSON parsing / unbounded scans

- `automation_events_inbox.input`/`output` are JSONB with a GIN index — appropriate if queries filter on JSON content, though no such filtering query was found in the traced code paths (the GIN index may be unused overhead if nothing queries by JSON key — **not confirmed either way**, would need `pg_stat_user_indexes` against the live DB to check index usage, which this audit did not do).
- `claimInboxEvents`'s `ORDER BY received_at ASC LIMIT $1` inside the `FOR UPDATE SKIP LOCKED` CTE relies on an index on `received_at` (or the partition's BRIN index) to avoid a full scan as the table grows — the migration includes a BRIN index on `started_at`, but the claim query orders by `received_at`, a **different column**. NOT VERIFIED whether `received_at` is indexed at all (it wasn't in the 16-column base migration schema this audit confirmed live — see doc 08 — meaning the live schema doesn't even have a `received_at` column matching the migration's `started_at`; this is downstream of the same P0 schema mismatch, not a separate issue).

## Ingestion isolation (performance-relevant)

Per doc 02: automation and alerting are architecturally decoupled from the ingestion critical path (async outbox for alerting, no wiring at all for automation). This is the single most important performance property for protecting ingestion, and it holds based on the code read in this audit.

## No blind index recommendations

Per audit rule #30-4, no new indexes are proposed here. If the schema-mismatch (doc 08) is resolved by writing the missing migration, that would be the appropriate time to also decide on `received_at`/`next_retry_at` indexing based on actual query plans against a populated table — not before.
