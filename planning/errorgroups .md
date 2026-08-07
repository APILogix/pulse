# Master Prompt: Redesign & Implement Enterprise-Grade Error Groups Lifecycle

You are acting as a **Principal Software Architect** responsible for redesigning the entire **Error Grouping subsystem** of an enterprise observability platform (Sentry/Datadog/Bugsnag/Rollbar class).

Your goal is **NOT** to preserve the existing implementation.

Instead, critically evaluate the current implementation and redesign it according to enterprise observability best practices.

The new implementation must be deterministic, scalable, race-condition safe, idempotent, release-aware, and maintainable.

---

# Objective

Completely redesign and implement the Error Groups lifecycle including:

- Fingerprinting
- Group creation
- Group updates
- Regression detection
- Status transitions
- Merge handling
- Severity escalation
- Release awareness
- API responses
- UI state
- Database consistency
- Alert triggering
- Audit history

The final implementation should behave similarly to enterprise products such as:

- Sentry
- Datadog
- Rollbar
- Bugsnag

---

# Phase 1 — Audit Existing Implementation

Analyze the entire backend.

Locate every file responsible for:

- ingestion
- fingerprint generation
- event normalization
- error grouping
- repositories
- SQL
- services
- controllers
- lifecycle APIs
- analytics workers
- alerting
- notification pipeline

Produce a dependency graph.

Do not skip any execution path.

---

# Phase 2 — Redesign Error Group Lifecycle

The lifecycle must become:

```
NEW EVENT

↓

Fingerprint

↓

Find Existing Group

↓

Group Exists?

↓

NO
↓

Create Group

↓

OPEN

-------------------------

YES

↓

Update Group

↓

Current Status?

↓

OPEN
RESOLVED
IGNORED
ARCHIVED
```

The lifecycle should support only these statuses:

```
OPEN

RESOLVED

IGNORED

ARCHIVED
```

Do NOT introduce a permanent REGRESSED state.

Regression is an event.

Not a lifecycle state.

---

# Phase 3 — Enterprise Regression Detection

Implement regression correctly.

Definition:

A regression occurs when:

- the fingerprint matches
- the project matches
- the issue was previously RESOLVED
- a new qualifying event arrives
- the event belongs to the current or newer release
- the event occurred after resolution

A regression MUST:

- reopen the issue
- set status = OPEN
- increment regression_count
- update last_regressed_at
- update last_seen_at
- update latest_event_id
- update latest_trace_id
- update latest_request_id
- update latest_severity
- continue occurrence_count

Regression must NEVER:

- create duplicate groups
- create duplicate regressions
- occur while status == OPEN
- occur because of duplicate SDK retries
- occur because of late historical events
- occur because of merge artifacts

---

# Phase 4 — Release-Aware Regression

Implement release-aware regression detection.

Introduce:

resolved_release

resolved_at

When an issue is resolved:

store

```
resolved_release
resolved_at
```

Regression should occur only if

```
incoming.release >= resolved_release

AND

incoming.occurred_at > resolved_at
```

Older releases must never reopen an issue.

---

# Phase 5 — Fingerprinting

Audit fingerprint generation.

Replace simplistic message-based fingerprints.

Fingerprint should be generated from:

- Error Type
- In-App Stack Frames
- Function Names
- File Names
- Line Numbers

Ignore:

- Dynamic IDs
- UUIDs
- User IDs
- Timestamps
- Variable values

Ensure deterministic grouping.

---

# Phase 6 — Severity Escalation

Maintain:

highest_severity

latest_severity

Rules:

latest_severity

always reflects newest event.

highest_severity

only increases.

Never decreases.

Implement deterministic severity ranking.

Example:

```
debug

↓

info

↓

warning

↓

error

↓

critical

↓

fatal
```

---

# Phase 7 — Merge Support

Implement enterprise merge handling.

If

```
Group A

↓

Merged Into

↓

Group B
```

then

future events

must automatically resolve to

Group B.

No future writes should update Group A.

Merged groups should never receive regressions.

---

# Phase 8 — State Machine

Implement the following transitions.

```
NEW

↓

OPEN

↓

RESOLVED

↓

OPEN (Regression)

↓

RESOLVED

↓

OPEN (Regression)
```

Manual transitions

```
OPEN → RESOLVED

OPEN → IGNORED

OPEN → ARCHIVED

IGNORED → OPEN

ARCHIVED → OPEN
```

Regression should never introduce another lifecycle status.

---

# Phase 9 — History

Introduce

error_group_history

Every transition must create an audit record.

Store:

- previous_status
- new_status
- actor
- event_id
- release
- timestamp
- reason

Never lose lifecycle history.

---

# Phase 10 — API Contract

List endpoint

Return:

```
id

status

errorName

message

occurrenceCount

firstSeenAt

lastSeenAt

highestSeverity

regressionCount

lastRegressedAt

latestRelease

environment

service

traceId
```

Detail endpoint

Return:

- fingerprint
- stack trace
- history
- merge information
- regression history
- release history
- affected users
- affected sessions

---

# Phase 11 — UI Behaviour

Error Groups page

Display

```
Issue

Status

Occurrences

Last Seen

Severity

Regression

Release

Environment
```

Regression badge

should be computed from

```
regressionCount

status

lastRegressedAt
```

Never rely on stale booleans.

---

# Phase 12 — Concurrency

Guarantee:

- row-level locking
- idempotent retries
- UPSERT safety
- optimistic locking
- transaction rollback
- duplicate SDK protection

No race conditions.

---

# Phase 13 — Performance

Verify:

- partition pruning
- proper indexes
- no sequential scans
- no N+1 queries
- no unnecessary joins

Ensure millions of events/day remain performant.

---

# Phase 14 — Notifications

Regression should publish:

```
ErrorGroupRegressed
```

Subscribers:

- Slack
- Discord
- Email
- PagerDuty
- Webhooks
- AI Incident Engine

Only after successful transaction commit.

Use the Transactional Outbox pattern.

---

# Phase 15 — Frontend Compatibility

Ensure frontend can display:

- regression badge
- reopen timeline
- history
- merge state
- release information
- severity
- trace navigation

without additional expensive API calls.

---

# Phase 16 — Deliverables

Produce:

## 1. Complete architecture review

---

## 2. New lifecycle diagram

---

## 3. Updated database schema

---

## 4. Updated SQL

---

## 5. Updated repository implementation

---

## 6. Updated services

---

## 7. Updated controllers

---

## 8. Updated APIs

---

## 9. Updated frontend contract

---

## 10. Updated state machine

---

## 11. Updated regression algorithm

---

## 12. Updated merge algorithm

---

## 13. Updated fingerprint algorithm

---

## 14. Updated severity algorithm

---

## 15. Complete migration plan

Existing data must migrate safely.

No data loss.

---

## 16. Comprehensive testing

Create tests for:

- New issue
- Existing issue
- Resolution
- Regression
- Duplicate SDK retry
- Concurrent ingestion
- Merge
- Unmerge
- Severity escalation
- Release-aware regression
- Late-arriving events
- Historical backfill
- Fingerprint collisions
- Manual lifecycle transitions
- Alert triggering

---

# Success Criteria

The final Error Groups implementation must be:

- Enterprise-grade
- Deterministic
- Idempotent
- Release-aware
- Race-condition safe
- Merge-aware
- Fingerprint-stable
- Highly performant
- Fully auditable
- Easy to maintain
- Comparable in behavior to Sentry and Datadog while fitting the existing Pulse architecture.
# Architecture Constraints (Do Not Change)

The current architecture computes and updates Error Groups synchronously during the error ingestion pipeline.

This is an intentional architectural decision and MUST remain unchanged unless a critical correctness issue is found.

Do NOT:

- Move Error Group calculation into a background worker.
- Move Error Group creation into analytics jobs.
- Introduce eventual consistency for Error Groups.
- Create a separate Error Group processing pipeline.
- Split Error Group creation into asynchronous stages.
- Move fingerprint generation outside the ingestion transaction.

The following responsibilities MUST remain inside the ingestion transaction:

1. Fingerprint generation
2. Error Group lookup
3. Error Group creation
4. Error Group update
5. Regression detection
6. Severity escalation
7. Occurrence count update
8. Latest snapshot update
9. Event persistence
10. Transaction commit

Only redesign the algorithms and implementation quality.

Do NOT redesign the architecture unless there is a correctness or data-integrity problem that cannot be solved within the existing ingestion pipeline.

If you believe an architectural change is necessary, do NOT implement it automatically.

Instead:

1. Explain the limitation.
2. Explain why the current architecture is insufficient.
3. Describe the proposed architecture.
4. Wait for approval before changing the execution flow.
