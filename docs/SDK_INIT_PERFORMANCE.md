# SDK initialization under load

Both `/v1/init` and `/v1/sdk-config` retain API-key verification and authoritative
configuration delivery. Requests are limited to 4 KiB bodies.

Concurrent identical API-key lookups share active work, as do identical delivery
lookups. Only SHA-256 key identifiers are used in the flight maps. Completed
flights are removed; this adds no credential or configuration TTL. Existing Redis
cache policy remains in effect.

Each lookup stage allows eight distinct active operations and 128 callers per
operation. The request has one shared 1,250 ms lookup deadline across both stages.
Capacity or deadline exhaustion returns 503 with `Retry-After: 1`. A timed-out
caller does not release an unfinished operation's capacity slot: slow database
work cannot grow without bound as replacement callers arrive. Existing PostgreSQL
pool and statement timeouts still govern that underlying work.

Redis lookup reads wait at most 100 ms before falling back to the database. A
timeout or read error opens a five-second read cooldown. At most 64 underlying
reads can remain pending. Cache invalidations and writes retain their existing
connection behavior and are not suppressed by the read cooldown.

CPU pressure now uses successive one-second event-loop utilization samples. The
installed under-pressure plugin measures utilization against its startup baseline;
that cumulative measure is disabled in favor of the rolling check. Heap, RSS,
event-loop-delay, readiness and explicit liveness exemption behavior is retained.
Real overload still rejects traffic; thresholds have not been raised.

Regression tests cover a 64-request cold burst (one authentication query and one
configuration build), warm-cache delivery, Redis stalls/recovery, lookup capacity,
deadline expiry without orphaning capacity, and CPU recovery after a busy sample.
These are local tests with mocked dependencies, not production latency benchmarks.

Readiness and build repairs made during verification:

- The gauge now sends one PGMQ metrics query; the previous code passed a second
  SQL string as its parameter array, causing readiness to fail.
- The billing worker loop is syntactically complete, alert queue provisioning
  accepts the immutable queue-name list, and DLQ messages use `failedAt`/`error`.
- Error-group inputs match the current model. Confirmed telemetry-writer inserts
  are grouped in the same transaction without another insert; the regular
  ingestion service path still deduplicates before grouping.

Validation: backend TypeScript typecheck passed; 41 focused tests passed across
delivery, Redis, admission, gauge, error grouping, and ingestion processing.
The backend Git index was already unreadable (`index file smaller than expected`);
no index repair, commit, or deployment was performed.
