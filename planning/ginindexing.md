# MASTER PROMPT — INGESTION PHASE 2
# PostgreSQL Write-Path Forensics, Index Optimization, Batch Optimization & Sustained-Load Performance

You are a senior PostgreSQL performance engineer and distributed-systems engineer working directly on a production-grade observability ingestion platform.

You are NOT starting from scratch.

A previous ingestion optimization phase has already implemented and verified several structural fixes. Your job is to continue from that state, audit what actually remains, prove the remaining bottlenecks with evidence, implement the highest-value fixes, and benchmark the result.

============================================================
0. CURRENT STATE — DO NOT REGRESS THIS
============================================================

The previous optimization phase already implemented:

1. DB connection starvation protection:
   - FIFO write-admission semaphore.
   - Permits derived from the live DB pool max.
   - Dedicated ingestion write pool.
   - Worker/database oversubscription structurally bounded.

2. Transaction safety:
   - statement_timeout introduced.
   - Boot guard prevents invalid timeout/re-delivery ordering.
   - Transactions cannot run indefinitely.

3. Queue-depth optimization:
   - Replaced LIKE 'ingest.%' with explicit queue matching.
   - Added queue-depth caching.

4. Error-group deadlock mitigation:
   - Deterministic ordering before FOR UPDATE.

5. Write amplification reduction:
   - Known duplicate events no longer unnecessarily enter the outbox.
   - Fingerprints are no longer redundantly hashed multiple times.

6. Memory protection:
   - Fetch concurrency reduced.
   - In-flight memory is now bounded.

7. Tenant fairness:
   - MUST remain intact.

8. synchronous_commit:
   - MUST remain ON unless hard runtime evidence proves changing it is safe and necessary.

9. Public-ID implementation:
   - MUST NOT be blindly removed.
   - Previous investigation indicated sequence-backed generation plus a contract trigger.
   - You MUST independently verify the exact current implementation before making any change.

10. GIN/JSONB indexes:
   - MUST NOT be blindly removed.
   - Their read-side necessity must first be established.

IMPORTANT:

Do NOT reimplement these previous fixes.
Do NOT undo them.
Do NOT increase worker concurrency blindly.
Do NOT increase DB pool size blindly.
Do NOT add Redis.
Do NOT add Kafka.
Do NOT weaken durability.
Do NOT disable tenant fairness.
Do NOT disable synchronous_commit simply to obtain better benchmark numbers.

============================================================
1. PRIMARY OBJECTIVE
============================================================

Determine why ingestion is still slow after the previous structural fixes.

Your objective is:

    MAXIMIZE SUSTAINED INGESTION THROUGHPUT
    WHILE MINIMIZING LATENCY AND RESOURCE CONTENTION
    WITHOUT SACRIFICING:
        - durability
        - correctness
        - idempotency
        - tenant fairness
        - query functionality
        - public-ID contracts
        - billing/usage accounting
        - outbox correctness
        - retry semantics

Focus specifically on the PostgreSQL write path and remaining ingestion bottlenecks.

============================================================
2. FIRST — ESTABLISH BASELINE
============================================================

Before modifying code or schema:

A. Inspect the complete ingestion architecture.

B. Inspect:
   - ingestion workers
   - queue configuration
   - DB pools
   - write-admission controls
   - transaction boundaries
   - batching logic
   - event processors
   - error grouping
   - trace/span insertion
   - outbox insertion
   - usage accounting
   - duplicate detection
   - retry behavior
   - ACK behavior
   - tenant fairness

C. Inspect the actual PostgreSQL schema.

D. Inspect every ingestion table:

   events_requests
   events_errors
   events_traces
   events_spans
   events_logs
   events_metrics
   events_messages
   events_replays
   events_profiles
   events_cron_checkins

   Also inspect:
   error_groups
   analytics_error_groups
   any staging/outbox/idempotency tables involved in ingestion.

E. Establish the current baseline from:
   - existing profiler logs
   - SQL logs
   - EXPLAIN/EXPLAIN ANALYZE
   - pg_stat_statements if available
   - PostgreSQL catalog metadata
   - lock information
   - WAL statistics
   - pool metrics
   - worker metrics.

DO NOT invent performance numbers.

If the benchmark database is unavailable, explicitly state:

    "Runtime throughput could not be measured."

Do not fabricate p50/p95/p99 or events/sec.

============================================================
3. BUILD A COMPLETE WRITE-PATH MAP
============================================================

For every event type, map:

SDK
 ↓
API/ingestion endpoint
 ↓
queue
 ↓
worker
 ↓
batch
 ↓
validation
 ↓
normalization
 ↓
DB connection acquisition
 ↓
BEGIN
 ↓
SQL statements
 ↓
indexes/triggers/defaults/constraints
 ↓
outbox
 ↓
COMMIT
 ↓
ACK

Create this separately for:

- request
- error
- trace
- span
- log
- metric
- message
- replay
- profile
- cron/check-in

Identify exactly which operations execute:

PER EVENT

and which execute:

PER BATCH.

The goal is to find hidden O(N) database work.

============================================================
4. DATABASE CONNECTION ANALYSIS
============================================================

Verify that the previous connection starvation fix is actually working.

Measure:

- pool max
- active connections
- idle connections
- checkout wait
- checkout wait p50/p95/p99
- transaction duration
- query duration
- worker concurrency
- write-admission permits
- queue depth.

Prove whether connection starvation still exists.

If:

    dbConnectionWaitMs ≈ 0

but total latency remains high,

DO NOT continue optimizing connection count.

Move investigation into PostgreSQL execution/write costs.

Do not increase pool size unless database capacity measurements justify it.

============================================================
5. INDEX FORENSICS — CRITICAL
============================================================

Inventory EVERY index on every ingestion-path table.

For each index determine:

- table
- index name
- index type
- columns
- expression
- partial predicate
- size
- uniqueness
- read usage
- write-path maintenance cost
- whether it is required for correctness
- whether it is required for foreign-key enforcement
- whether it is required for common production queries
- whether it is redundant
- whether it is used by ingestion queries
- whether it is used only by analytics/read paths.

Pay particular attention to:

- GIN
- JSONB
- expression indexes
- wide composite indexes
- indexes containing high-cardinality columns
- duplicate/redundant indexes.

For every expensive index answer:

    What query requires it?

    How frequently is that query executed?

    What is the read benefit?

    What is the write cost?

    Can the read requirement be served by a narrower index?

    Can the indexed data be moved to a derived/analytics table?

    Can the index be partial?

    Can it be asynchronous?

Only remove an index if evidence demonstrates that removal is safe.

NEVER remove an index merely because it is expensive.

============================================================
6. GIN / JSONB FORENSICS
============================================================

Explicitly investigate every JSONB/GIN index.

For each one:

1. Find all application queries that could use it.
2. Find actual database usage where available.
3. Run EXPLAIN ANALYZE for representative queries.
4. Determine whether the index is actually necessary.
5. Determine its size.
6. Determine its write amplification.
7. Determine whether it materially increases INSERT latency.
8. Determine whether a narrower or alternative index can satisfy the same workload.

Possible outcomes:

A. KEEP
B. REPLACE
C. NARROW
D. PARTIAL
E. MOVE TO DERIVED TABLE
F. REMOVE

Do not automatically choose REMOVE.

The decision must be evidence-backed.

============================================================
7. TRIGGER FORENSICS — DO NOT BLINDLY DELETE
============================================================

Inventory EVERY trigger on every ingestion table.

For every trigger determine:

- trigger name
- table
- timing
- event
- function
- number of statements executed
- whether it fires once per row
- whether it performs SQL
- whether it modifies the inserted row
- whether it performs external work
- whether it performs expensive computation.

Specifically inspect public-ID generation.

Determine whether public_id is generated through:

A. DEFAULT nextval(sequence)

B. BEFORE INSERT trigger

C. BOTH

D. application code

E. another mechanism.

Prove exactly what happens for one inserted row.

The fact that a trigger creates no client round trips does NOT mean it is free.

Measure or reason from actual implementation whether its CPU/database overhead is material.

IMPORTANT:

DO NOT DELETE THE PUBLIC-ID TRIGGER JUST BECAUSE IT IS A TRIGGER.

If it enforces an important contract, preserve it.

If it is redundant because a sequence-backed DEFAULT already guarantees the required behavior, document that fact and only remove it if the contract is demonstrably preserved.

If it is cheap and necessary, KEEP IT.

============================================================
8. DEFAULT / SEQUENCE FORENSICS
============================================================

For every public ID:

Verify:

- sequence
- DEFAULT expression
- trigger
- trigger function
- uniqueness requirements
- public-ID format
- concurrency behavior
- transaction behavior
- rollback behavior
- gaps in IDs
- whether IDs must be globally unique or only human-readable.

Determine whether sequence generation is already the cheapest safe solution.

Do not replace sequences with application-side counters.

============================================================
9. INSERT PERFORMANCE FORENSICS
============================================================

For each major ingestion table measure:

- rows inserted
- bytes inserted
- INSERT duration
- rows/sec
- MB/sec
- WAL generated
- index count
- index size
- trigger execution
- constraint checks
- FK checks
- generated/default column work
- lock waits
- IO waits
- CPU.

Pay particular attention to:

events_traces
events_spans
events_logs
events_requests
events_errors

Earlier evidence showed expensive insertion times for traces/spans/logs.

Determine whether that cost comes from:

- index maintenance
- WAL
- table bloat
- row width
- TOAST
- JSONB
- triggers
- constraints
- locks
- disk IO
- CPU
- connection contention
- transaction size
- query design.

DO NOT guess.

============================================================
10. EXPLAIN / SQL FORENSICS
============================================================

Find the exact SQL responsible for the largest database costs.

For every expensive query record:

- query ID
- caller
- exact SQL
- parameters shape
- execution count
- mean duration
- total duration
- rows
- plan
- indexes touched
- locks
- buffers
- WAL where available.

Use:

EXPLAIN (ANALYZE, BUFFERS, WAL, VERBOSE)

where safe and appropriate.

Do NOT run dangerous EXPLAIN ANALYZE against production blindly.

Use staging or controlled environments where required.

============================================================
11. ERROR INGESTION QUERY AMPLIFICATION
============================================================

Verify the previously identified:

    Q(N) = 3N + 6

pattern.

Find whether error ingestion still performs:

1. INSERT error_group
2. SELECT ... FOR UPDATE
3. UPDATE error_group

for every event.

If yes, replace it with a set-based strategy.

The target architecture should prefer:

- one batch-level grouping operation
- one set-based upsert/update
- one event insertion
- one mapping operation

rather than:

    N events × multiple SQL statements.

Preserve:

- occurrence_count
- first_seen
- last_seen
- grouping correctness
- concurrency safety
- idempotency.

Prove query count before and after.

============================================================
12. TRANSACTION ANALYSIS
============================================================

Analyze:

- transaction duration
- BEGIN latency
- INSERT latency
- outbox latency
- COMMIT latency
- connection hold time
- WAL flush
- lock waits.

Determine whether large transactions are causing:

- connection starvation
- lock contention
- WAL spikes
- checkpoint pressure
- tail latency
- tenant interference.

Do not blindly shrink every batch.

Find the optimal batch size empirically.

============================================================
13. BATCH SIZE OPTIMIZATION
============================================================

Benchmark multiple batch sizes.

At minimum test representative sizes such as:

- 1
- 10
- 25
- 50
- 100
- 200
- 500

where supported by the system.

Measure:

- events/sec
- MB/sec
- transaction duration
- connection hold time
- queue wait
- DB checkout wait
- INSERT duration
- COMMIT duration
- WAL
- CPU
- memory.

Determine the point where batching stops improving throughput.

Do not assume:

    bigger batch = faster.

============================================================
14. WAL / COMMIT FORENSICS
============================================================

Investigate expensive COMMIT times.

For slow commits determine whether the cause is:

- WAL flush
- disk latency
- checkpoint activity
- lock contention
- synchronous_commit behavior
- concurrent write pressure.

Keep:

    synchronous_commit = on

unless hard evidence proves another configuration is safe for the product's durability requirements.

Do not trade durability for benchmark performance.

============================================================
15. TABLE BLOAT / STORAGE ANALYSIS
============================================================

Inspect:

- table size
- index size
- dead tuples
- autovacuum
- vacuum frequency
- analyze frequency
- TOAST usage
- table/index bloat where measurable.

Determine whether bloat or vacuum pressure contributes to ingestion latency.

Do not randomly VACUUM FULL production tables.

============================================================
16. CROSS-EVENT WORKLOAD INTERFERENCE
============================================================

Determine whether:

trace/span ingestion

is starving:

request/log/error ingestion.

Measure per event type:

- queue wait
- DB wait
- transaction time
- throughput
- latency.

If expensive workloads interfere with lighter workloads, consider:

- bounded concurrency by event type
- separate admission classes
- controlled resource allocation

while preserving tenant fairness.

Do NOT blindly create separate pools for every event type.

Only do so if measurements justify it.

============================================================
17. TENANT FAIRNESS
============================================================

Tenant fairness MUST remain.

Verify that optimization does not allow:

one high-volume tenant

to monopolize:

- worker slots
- DB connections
- write permits
- transaction capacity.

Measure fairness under mixed workloads.

============================================================
18. MEMORY / BACKPRESSURE
============================================================

Verify that the previous OOM protection remains intact.

Calculate worst-case memory:

    in-flight jobs
    × maximum payload
    × concurrency

plus:

    DB buffers
    serialized batches
    queue metadata
    application overhead.

Ensure bounded memory under worst-case load.

Do not solve throughput problems by creating unbounded queues.

============================================================
19. WRITE AMPLIFICATION
============================================================

Calculate:

    input events
        ↓
    DB rows written
        ↓
    indexes updated
        ↓
    outbox rows
        ↓
    auxiliary rows
        ↓
    WAL bytes.

Identify unnecessary write amplification.

Known duplicates MUST NOT trigger unnecessary downstream writes.

Do not remove required durability writes merely to improve throughput.

============================================================
20. BENCHMARK MATRIX
============================================================

Use the existing benchmark harness if available:

    npm run bench:ingestion:matrix

Inspect its implementation before changing it.

Create a controlled benchmark matrix covering:

A. small batches
B. medium batches
C. large batches
D. mixed event types
E. duplicate-heavy workload
F. error-heavy workload
G. trace/span-heavy workload
H. multi-tenant workload
I. sustained high-volume workload.

Measure:

- events/sec
- MB/sec
- p50
- p95
- p99
- queue wait
- DB connection wait
- transaction duration
- INSERT duration
- COMMIT duration
- WAL
- CPU
- memory
- DB connections
- error rate
- duplicate rate.

If runtime benchmarking cannot be performed, explicitly document why.

NEVER fabricate numbers.

============================================================
21. IMPLEMENTATION RULES
============================================================

Only implement changes supported by evidence.

Prioritize:

P0:
- correctness-threatening bottlenecks
- connection starvation
- transaction runaway
- deadlocks
- data-loss risks

P1:
- major ingestion latency
- DB write amplification
- expensive SQL
- index overhead
- WAL/COMMIT problems
- workload interference

P2:
- secondary optimization
- code cleanup
- observability improvements.

Avoid:

- Redis
- Kafka
- unnecessary microservices
- unnecessary database pools
- blind concurrency increases
- blind index removal
- blind trigger removal
- disabling durability
- per-event transactions
- per-event SQL where batch SQL is possible
- unbounded queues.

============================================================
22. BEFORE/AFTER PROOF
============================================================

For every optimization implemented, provide:

BEFORE:
- exact bottleneck
- measured evidence
- query count
- latency
- resource cost

CHANGE:
- exact code/schema/config modification

AFTER:
- same measurement
- improvement
- regression check.

Do not claim an optimization worked unless there is evidence.

============================================================
23. REGRESSION TESTING
============================================================

Verify:

- event persistence
- duplicate handling
- error grouping
- occurrence counting
- outbox correctness
- public IDs
- tenant fairness
- retry behavior
- ACK semantics
- usage accounting
- trace/span relationships
- request relationships
- transaction rollback
- database constraints.

Run existing tests.

Compare against the previous baseline.

Do not introduce unrelated fixes.

============================================================
24. FINAL DELIVERABLE
============================================================

Create a detailed forensic report.

Include:

1. Current architecture
2. Previous fixes and their current status
3. Current bottleneck ranking
4. Exact SQL responsible for remaining latency
5. Complete index inventory
6. GIN/JSONB analysis
7. Complete trigger inventory
8. Public-ID generation analysis
9. Sequence/default analysis
10. INSERT performance analysis
11. Transaction analysis
12. WAL/COMMIT analysis
13. Batch-size analysis
14. Connection-pool analysis
15. Queue/backpressure analysis
16. Tenant fairness analysis
17. Write-amplification analysis
18. Exact changes implemented
19. Before/after benchmark results
20. Remaining bottlenecks
21. Risks
22. Recommended next phase.

============================================================
25. FINAL VERDICT
============================================================

End with a blunt engineering verdict:

A. What was actually fixed?
B. What remains slow?
C. What is now the #1 bottleneck?
D. What evidence proves it?
E. What optimization produced the largest improvement?
F. What optimization should NOT be performed?
G. What is required before calling ingestion production-ready for heavy load?

IMPORTANT:

Do not declare the ingestion pipeline "fast" merely because architectural issues were fixed.

The final acceptance criterion is measured sustained throughput and latency under realistic heavy load.

The objective is not to make the code look optimized.

The objective is to make the ingestion system demonstrably capable of sustained high-volume telemetry ingestion without collapsing under concurrency, database pressure, large batches, duplicate traffic, or multi-tenant workloads.