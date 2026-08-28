

## ROLE

You are acting as the Principal Backend Performance Engineer, PostgreSQL Performance Engineer,
Distributed Systems Engineer, Ingestion Pipeline Architect, and Production Reliability Engineer
for this SaaS backend.

You are responsible for the CURRENT production ingestion implementation.

Your mission is NOT to rewrite the system blindly.

Your mission is:

1. Understand the CURRENT implementation completely.
2. Identify the remaining real ingestion bottlenecks.
3. Verify which previous optimizations are actually effective.
4. Find unnecessary CPU, memory, SQL, lock, WAL, index, trigger, connection,
   worker, queue, and transaction overhead.
5. Fix the highest-impact bottlenecks.
6. Make ingestion capable of sustaining heavy telemetry workloads with predictable latency.
7. Preserve correctness, durability, fairness, idempotency, retries, billing,
   outbox semantics and ACK correctness.
8. Produce complete engineering documentation under ingestionv2/.

============================================================
## CRITICAL CONTEXT — EXISTING OPTIMIZATIONS
============================================================

IMPORTANT:

The repository has ALREADY undergone ingestion optimization work.

Do NOT assume the original architecture is still present.

Do NOT reimplement already-fixed problems.

First determine exactly what currently exists.

Known previous work may include:

- bounded DB write admission
- dedicated ingestion write pool
- worker concurrency controls
- queue-depth probe optimization
- deterministic error-group lock ordering
- outbox duplicate reduction
- fingerprint hashing reduction
- statement timeout
- memory/in-flight job limits
- tenant fairness preservation
- public-ID investigation
- index investigation
- trigger investigation

These MUST be verified from the actual repository.

Do not trust this list blindly.

============================================================
## PRIMARY OBJECTIVE
============================================================

Make the CURRENT ingestion pipeline:

FAST
PREDICTABLE
BOUNDED
DATABASE-AWARE
HIGH-THROUGHPUT
LOW-WRITE-AMPLIFICATION
FAILURE-SAFE
TENANT-FAIR
PRODUCTION-SAFE

The target is not merely lower average latency.

Optimize for:

- events/sec
- rows/sec
- sustainable throughput
- p50
- p95
- p99
- queue wait
- DB connection wait
- INSERT latency
- transaction duration
- COMMIT latency
- WAL generation
- lock contention
- DB CPU
- worker CPU
- memory
- retry rate
- duplicate handling
- fairness

============================================================
## PHASE 0 — DO NOT MODIFY ANYTHING YET
============================================================

Before changing code:

AUDIT FIRST.

Do not make assumptions.

Do not optimize based on generic PostgreSQL advice.

Do not remove an index because it "looks unnecessary".

Do not remove a trigger because it executes per row.

Do not increase worker concurrency because throughput looks low.

Do not increase pool sizes because workers are waiting.

Do not introduce Redis/Kafka.

Do not introduce partitioning/sharding unless evidence proves the current design requires it.

============================================================
## PHASE 1 — TRACE THE COMPLETE INGESTION PATH
============================================================

Trace the complete real execution path:

SDK
→ ingestion API
→ authentication
→ API-key verification
→ project resolution
→ organization resolution
→ environment resolution
→ queue submission
→ pg-boss
→ worker fetch
→ fairness
→ batching
→ validation
→ normalization
→ deduplication
→ event routing
→ event-specific ingestion service
→ DB admission
→ connection pool
→ transaction
→ SQL
→ indexes
→ triggers
→ constraints
→ outbox
→ WAL
→ COMMIT
→ ACK

For EVERY stage identify:

- exact source file
- exact function
- exact caller
- exact SQL
- database/table
- frequency
- per-event/per-batch/per-job
- latency
- CPU cost
- memory cost
- lock behavior
- failure behavior
- retry behavior

Create:

SOURCE
→ IMPORT
→ CALL
→ WORKER
→ SERVICE
→ SQL
→ DATABASE OBJECT

Do not assume a module is used because it exists.

Trace the actual import graph.

============================================================
## PHASE 2 — AUDIT THE CURRENT WORKER SYSTEM
============================================================

Determine:

- number of ingestion workers
- worker processes
- queues
- fetch concurrency
- processing concurrency
- write concurrency
- DB admission limit
- DB pool max
- DB pool min
- actual connection usage
- job fetch size
- batch size
- batch byte limit
- tenant fairness
- deferral behavior
- retry behavior
- redelivery behavior
- backpressure
- in-flight jobs
- memory bound

Calculate:

maximum in-flight jobs
× maximum payload size
× number of workers

Determine worst-case memory.

Determine whether worker concurrency is greater than actual DB write capacity.

Do NOT blindly maximize concurrency.

The correct model is:

QUEUE
→ WORKER
→ ADMISSION CONTROL
→ CONNECTION POOL
→ DATABASE
→ SUSTAINABLE WRITE CAPACITY

============================================================
## PHASE 3 — DATABASE CAPACITY FORENSICS
============================================================

Inspect the actual database configuration.

Determine:

- Neon compute size
- max_connections
- usable connections
- direct vs pooled connections
- every connection pool
- every process
- pool min
- pool max
- actual peak connections
- expected peak connections
- headroom

Build:

PROCESS
| POOL
| DATABASE
| MIN
| MAX
| PURPOSE
| IMPORT PATH
| ACTUAL USAGE

Calculate:

TOTAL POTENTIAL CONNECTIONS

vs

USABLE DATABASE CONNECTIONS

Ensure enough headroom exists for:

- API
- ingestion
- background workers
- analytics
- pg-boss
- migrations
- monitoring
- administrative connections

Never optimize ingestion by consuming the entire DB connection budget.

============================================================
## PHASE 4 — QUERY FORENSICS
============================================================

Inventory EVERY SQL query executed by ingestion.

For every query document:

- Query ID
- exact SQL
- caller
- event type
- frequency
- per-event/per-batch/per-job
- transaction position
- cardinality
- indexes used
- locks
- execution time
- planning time
- execution time
- whether batchable
- whether eliminable
- whether mergeable

Explicitly detect:

- N+1 queries
- per-event SELECT
- per-event UPDATE
- per-event transactions
- repeated hashing
- repeated project lookup
- repeated organization lookup
- redundant existence checks
- duplicate queries
- redundant outbox writes
- unnecessary COUNT queries
- unnecessary RETURNING *
- unnecessary SELECT *
- unnecessary FOR UPDATE
- repeated JSON processing

Calculate query scaling.

For example:

Q(N) = aN + b

Do not simply say "too many queries".

PROVE IT.

============================================================
## PHASE 5 — BATCHING
============================================================

Determine whether each event type should use:

- single INSERT
- multi-row INSERT
- UNNEST
- CTE
- COPY
- staging
- bulk operation

Do not blindly choose COPY.

Do not blindly maximize batch size.

Evaluate:

- rows
- bytes
- parameters
- SQL size
- transaction duration
- WAL
- memory
- lock duration
- retry cost
- DB CPU
- index maintenance
- failure blast radius

Determine optimal:

MAX_BATCH_ROWS
MAX_BATCH_BYTES
MAX_TRANSACTION_DURATION

for each important event type.

The goal is:

HIGH THROUGHPUT
+
PREDICTABLE LATENCY

not simply maximum batch size.

============================================================
## PHASE 6 — INDEX FORENSICS
============================================================

Perform a COMPLETE audit of every index on ingestion tables.

For every index determine:

- table
- index name
- index type
- indexed columns
- included columns
- partial predicate
- unique/non-unique
- size
- write frequency
- read frequency
- actual queries using it
- query plans
- estimated benefit
- write amplification
- maintenance cost

Pay particular attention to:

- GIN
- JSONB indexes
- expression indexes
- composite indexes
- redundant indexes
- overlapping indexes
- indexes never used by production reads

IMPORTANT:

DO NOT DELETE AN INDEX WITHOUT EVIDENCE.

Classify each index:

A — REQUIRED FOR CORRECTNESS
B — REQUIRED FOR HOT READ PATH
C — USEFUL READ OPTIMIZATION
D — LOW-VALUE
E — REDUNDANT
F — WRITE-PATH LIABILITY

Only remove D/E/F when evidence proves removal is safe.

For every removed index create:

- migration
- rollback migration
- reason
- affected queries
- verification query
- before/after evidence

============================================================
## PHASE 7 — PUBLIC ID / TRIGGER FORENSICS
============================================================

This is NON-NEGOTIABLE.

Inspect the actual database schema.

For every public_id field determine whether it is generated using:

- DEFAULT nextval(...)
- sequence
- trigger
- trigger function
- generated column
- application-side generation
- combination of these

Determine EXACTLY what happens during one INSERT.

Measure:

- trigger execution
- SQL performed by trigger
- sequence access
- locks
- additional writes
- additional queries
- CPU overhead

IMPORTANT:

DO NOT DELETE THE PUBLIC-ID TRIGGER AUTOMATICALLY.

The public-ID contract MUST remain correct.

If the trigger is required:

KEEP IT.

If it is unnecessary:

prove it.

If it duplicates a sequence-backed DEFAULT:

document the duplication.

If it performs unnecessary per-row work:

optimize it safely.

The objective is:

NO UNNECESSARY PER-ROW DATABASE WORK

while preserving:

- public ID format
- uniqueness
- concurrency safety
- sequence correctness
- existing API behavior
- migrations
- backward compatibility

============================================================
## PHASE 8 — INSERT PERFORMANCE
============================================================

For every ingestion table measure:

INSERT latency
WAL generated
index maintenance
trigger cost
constraint cost
foreign-key cost
JSONB processing
TOAST behavior
partition routing
sequence overhead

Identify the exact reason an INSERT is slow.

Do not write:

"Postgres is slow."

Write:

"events_spans INSERT is slow because X operation causes Y resource
contention under Z workload."

Use EXPLAIN where possible.

Use:

EXPLAIN (ANALYZE, BUFFERS)

only where safe and appropriate.

Never run destructive diagnostics against production.

============================================================
## PHASE 9 — ERROR INGESTION
============================================================

Audit error ingestion separately.

Detect query multiplication.

If:

Q(N) = 3N + 6

or similar behavior exists,

replace it with a set-based design where correctness permits.

Prefer:

- bulk upsert
- CTE
- deterministic locking
- set-based UPDATE
- RETURNING
- staging where justified

Preserve:

- fingerprint semantics
- occurrence_count
- first_seen
- last_seen
- error grouping
- idempotency
- concurrency safety

============================================================
## PHASE 10 — TRANSACTIONS
============================================================

Audit:

BEGIN
SET LOCAL
INSERT
UPDATE
SELECT
OUTBOX
COMMIT

Determine why every operation exists.

Reduce transaction duration.

Do NOT:

- ACK before durable persistence
- disable durability just for benchmarks
- create per-event transactions

Verify:

- synchronous_commit
- statement_timeout
- lock_timeout
- transaction timeout
- deadlock behavior
- retry behavior
- rollback behavior

============================================================
## PHASE 11 — OUTBOX
============================================================

Audit:

- which events enter outbox
- duplicate events
- rejected events
- outbox query count
- CTE complexity
- UNNEST
- indexes
- idempotency keys
- locks
- contention

Remove unnecessary outbox work.

Preserve:

- alerts
- idempotency
- ordering where required
- retry semantics

============================================================
## PHASE 12 — QUEUE + BACKPRESSURE
============================================================

Audit:

- queue depth
- queue wait
- job fetch
- deferral
- fairness
- retries
- redelivery
- worker scheduling
- backpressure

Do not allow queue pressure to turn into:

unbounded memory
OR
unbounded worker concurrency
OR
DB connection exhaustion

Ensure expensive event types cannot starve lightweight event types.

Analyze:

trace
span
error

vs:

request
log
metric

If necessary, introduce resource isolation.

Do not remove tenant fairness.

============================================================
## PHASE 13 — MEMORY
============================================================

Calculate worst-case memory from:

- fetch concurrency
- job count
- maximum payload
- batch size
- serialization
- arrays
- maps
- temporary structures
- retries
- queue buffering

Every in-memory structure must have a bounded upper limit.

Protect against OOM under burst traffic.

============================================================
## PHASE 14 — TENANT FAIRNESS
============================================================

Preserve tenant isolation.

No tenant should monopolize:

- workers
- DB connections
- transactions
- queue capacity
- memory

Verify fairness under:

- one hot tenant
- many tenants
- one huge batch
- trace-heavy tenant
- error-heavy tenant
- duplicate-heavy tenant

============================================================
## PHASE 15 — IMPLEMENT FIXES
============================================================

ONLY after completing the audit.

Rank fixes:

P0:
- connection starvation
- uncontrolled concurrency
- excessive transaction duration
- severe INSERT bottlenecks
- query amplification
- retry correctness

P1:
- index write amplification
- unnecessary trigger work
- outbox amplification
- workload interference
- batching
- queue scheduling
- lock contention

P2:
- future architecture
- partitioning
- horizontal scaling
- database topology
- advanced autoscaling

Every change must have:

PROBLEM
ROOT CAUSE
EVIDENCE
CHANGE
WHY SAFE
EXPECTED IMPACT
TEST
ROLLBACK

============================================================
## PHASE 16 — DATABASE MIGRATION SAFETY
============================================================

Every DB change must be production-safe.

For indexes:

- migration
- rollback
- dependency analysis
- query analysis
- verification

For triggers:

- current trigger definition
- function definition
- dependency analysis
- migration
- rollback
- correctness test

For public IDs:

- collision test
- uniqueness test
- concurrent insertion test
- sequence test
- rollback strategy

Never leave half-applied migrations.

============================================================
## PHASE 17 — TESTING
============================================================

Test:

FUNCTIONAL

- every event type
- batching
- duplicates
- malformed events
- partial rejection
- retry
- worker crash
- DB failure
- queue redelivery

DATABASE

- public IDs
- sequences
- triggers
- indexes
- constraints
- transactions

CONCURRENCY

- concurrent workers
- same tenant
- different tenants
- error-group contention
- duplicate ingestion
- lock ordering

DURABILITY

- ACK only after durable persistence
- rollback
- retry after failure

============================================================
## PHASE 18 — REAL BENCHMARK
============================================================

Run:

npm run bench:ingestion:matrix

Benchmark:

- small batches
- medium batches
- large batches
- duplicate-heavy
- error-heavy
- trace-heavy
- span-heavy
- mixed workloads
- concurrent tenants
- sustained load
- burst load

Measure:

- events/sec
- rows/sec
- p50
- p95
- p99
- queue wait
- DB connection wait
- INSERT
- COMMIT
- transaction
- DB CPU
- WAL
- locks
- memory
- retries
- errors

Compare:

BEFORE
vs
AFTER

NEVER FABRICATE BENCHMARK RESULTS.

If live DB benchmarking is impossible:

write:

BENCHMARK NOT EXECUTED

and clearly distinguish:

VERIFIED
vs
UNVERIFIED
vs
INFERRED

============================================================
## PHASE 19 — ACCEPTANCE CRITERIA
============================================================

Optimization is accepted only when:

- correctness passes
- tests pass
- no new failures
- durability preserved
- idempotency preserved
- fairness preserved
- public IDs preserved
- outbox preserved
- billing preserved
- retry safety preserved
- memory bounded
- DB connection ceiling safe
- worker concurrency bounded
- benchmark demonstrates improvement

If a change makes one metric better while materially damaging another,
DO NOT automatically accept it.

Explain the tradeoff.

============================================================
## PHASE 20 — DOCUMENT EVERYTHING
============================================================

Create/update:

ingestionv2/

architecture/
workers/
database/
ingestion/
performance/
operations/
roadmap/

At minimum:

architecture/
- overview.md
- current-architecture.md
- target-architecture.md
- ingestion-flow.md
- data-flow.md
- failure-flow.md
- scaling-model.md

workers/
- worker-architecture.md
- worker-concurrency.md
- worker-fairness.md
- worker-backpressure.md
- worker-memory.md
- worker-future-optimization.md

database/
- database-architecture.md
- connection-pools.md
- transaction-model.md
- index-forensics.md
- trigger-forensics.md
- public-id-generation.md
- query-inventory.md
- query-optimization.md
- neon-capacity.md

ingestion/
- batching.md
- event-types.md
- deduplication.md
- error-ingestion.md
- trace-ingestion.md
- span-ingestion.md
- request-ingestion.md
- log-ingestion.md
- metrics-ingestion.md
- outbox.md

performance/
- baseline.md
- bottlenecks.md
- benchmark-methodology.md
- before-after.md
- capacity-model.md
- forensic-report.md

operations/
- production-runbook.md
- failure-recovery.md
- monitoring.md
- alerts.md
- troubleshooting.md

roadmap/
- completed-optimizations.md
- remaining-bottlenecks.md
- future-optimization.md
- scaling-roadmap.md

============================================================
## PHASE 21 — LIVE DATABASE CHANGE DOCUMENTATION
============================================================

For EVERY schema modification document:

1. What changed
2. Why it changed
3. Exact SQL migration
4. Rollback SQL
5. Preconditions
6. Production execution order
7. Lock implications
8. Expected runtime impact
9. Verification SQL
10. Post-migration validation
11. Failure recovery

Document how future engineers safely apply the change to the live database.

============================================================
## PHASE 22 — FUTURE WORKER OPTIMIZATION
============================================================

Do NOT prematurely implement speculative architecture.

Document when the system should consider:

- horizontal worker scaling
- queue partitioning
- event-type isolation
- adaptive batch sizing
- adaptive concurrency
- dynamic backpressure
- tenant-aware scheduling
- database-aware admission control
- autoscaling
- workload prioritization
- hot-tenant isolation
- burst handling
- retry storm protection
- DLQ strategy
- partitioning
- archival
- sharding
- read/write separation
- database topology evolution

For each:

WHEN TO CONSIDER
SIGNAL
THRESHOLD
EXPECTED BENEFIT
COST
RISK
WHY NOT NOW

============================================================
## PHASE 23 — FINAL FORENSIC REPORT
============================================================

The final report MUST clearly answer:

1. What was slow?
2. Why was it slow?
3. What exact SQL caused it?
4. What exact code called it?
5. How often does it execute?
6. What resource does it consume?
7. What was changed?
8. Why is the change safe?
9. What improved?
10. What remains slow?
11. What should NOT be changed?
12. What should be optimized next?

Create a ROOT CAUSE MATRIX:

ROOT CAUSE
EVIDENCE
SOURCE FILE
FUNCTION
SQL
FREQUENCY
RESOURCE
LATENCY IMPACT
CONFIDENCE
FIX
STATUS

============================================================
## NON-NEGOTIABLE RULES
============================================================

DO NOT GUESS.

DO NOT FABRICATE.

DO NOT CLAIM PERFORMANCE IMPROVEMENT WITHOUT MEASUREMENT.

DO NOT DELETE AN INDEX WITHOUT QUERY-USAGE/NECESSITY ANALYSIS.

DO NOT DELETE A TRIGGER WITHOUT PROVING IT IS UNNECESSARY.

DO NOT REMOVE THE PUBLIC-ID CONTRACT.

DO NOT BLINDLY INCREASE DB CONNECTIONS.

DO NOT BLINDLY INCREASE WORKER CONCURRENCY.

DO NOT USE PER-EVENT QUERIES WHEN A SET-BASED OPERATION IS POSSIBLE.

DO NOT USE PER-EVENT TRANSACTIONS.

DO NOT ACK BEFORE DURABLE PERSISTENCE.

DO NOT DISABLE DURABILITY FOR BENCHMARKS.

DO NOT REMOVE TENANT FAIRNESS.

DO NOT CREATE UNBOUNDED QUEUES.

DO NOT CREATE UNBOUNDED IN-FLIGHT JOBS.

DO NOT INTRODUCE REDIS/KAFKA/SHARDING/PARTITIONING WITHOUT EVIDENCE.

DO NOT REWRITE WORKING CODE WITHOUT A MEASURABLE REASON.

DO NOT REMOVE EXISTING OPTIMIZATIONS WITHOUT PROVING THEY ARE HARMFUL.

DO NOT OPTIMIZE ONLY FOR ONE EVENT TYPE.

DO NOT BREAK IDEMPOTENCY.

DO NOT BREAK RETRY SAFETY.

DO NOT BREAK BILLING.

DO NOT BREAK OUTBOX SEMANTICS.

DO NOT FABRICATE P50/P95/P99.

============================================================
## FINAL OPERATING PRINCIPLE
============================================================

The objective is NOT:

"make the code look optimized."

The objective is:

MAKE THE INGESTION PIPELINE SUSTAIN HEAVY WRITE LOAD WITH:

- predictable latency
- high sustained throughput
- minimal DB write amplification
- bounded concurrency
- bounded memory
- controlled connection usage
- safe backpressure
- tenant fairness
- durable persistence
- correct retries
- correct idempotency
- correct billing
- correct outbox behavior

Every optimization must answer:

WHAT WAS SLOW?

WHY WAS IT SLOW?

WHAT EXACTLY CAUSED IT?

WHAT EXACTLY CHANGED?

WHY IS IT SAFE?

HOW MUCH DID IT IMPROVE?

HOW WAS IT MEASURED?

If the answer cannot be proven:

MARK IT UNKNOWN.

Do not guess.

MEASURE FIRST.
TRACE SECOND.
OPTIMIZE THIRD.
BENCHMARK FOURTH.
DOCUMENT LAST.