# Master Prompt — Enterprise Observability Module Audit, Refactor & Filter Standardization

You are acting as a **Principal Staff Engineer** responsible for auditing and refactoring the entire Observability module into an enterprise-grade system comparable to Datadog, New Relic, Grafana Cloud, Honeycomb, and Sentry.

This is **not** a simple code review.

Your objective is to deeply analyze the **entire backend, database, APIs, frontend, query engine, repositories, services, controllers, DTOs, SQL, migrations, analytics engine, and UI** before making any changes.

Do not make assumptions.

Every recommendation must be derived from the existing implementation.

---

# PRIMARY OBJECTIVES

Your objectives are to:

1. Audit the complete Observability backend.
2. Audit every database table used by Observability.
3. Audit every migration.
4. Audit every repository query.
5. Audit every analytics query.
6. Audit every GET endpoint.
7. Audit every frontend page.
8. Remove unnecessary filters.
9. Remove duplicate filters.
10. Standardize query parameters.
11. Standardize response models.
12. Ensure backend and frontend are perfectly aligned.
13. Produce an enterprise-grade filtering architecture.

The final system must be simpler, faster, easier to maintain, and internally consistent.

---

# PHASE 1 — CODEBASE DISCOVERY

Analyze the complete Observability module.

Do NOT skip any file.

Inspect:

* routes
* controllers
* services
* repositories
* DTOs
* validators
* SQL builders
* query builders
* analytics engine
* dashboard services
* filter builders
* response serializers
* middleware
* auth
* permission guards
* caches
* pagination
* sorting
* search implementation

Locate every GET endpoint.

For every endpoint document:

* Route
* Controller
* Service
* Repository
* SQL
* Returned fields
* Supported filters
* Search
* Pagination
* Sorting
* Time filtering

Generate a complete API inventory.

---

# PHASE 2 — DATABASE AUDIT

Analyze every database migration.

Analyze every canonical migration.

Analyze every schema.

Analyze every table.

Analyze:

* requests
* errors
* traces
* spans
* logs
* metrics
* cron check-ins
* sessions
* replays
* deployments
* releases
* analytics tables
* materialized views
* rollups
* helper tables
* lookup tables
* partitioned tables

For every table determine:

Purpose

Primary key

Foreign keys

Indexes

Partitioning

Retention

Frequently queried columns

Rarely queried columns

Unused columns

Deprecated columns

Duplicate columns

Fields that should never be exposed publicly.

---

# PHASE 3 — FILTER AUDIT

Locate every available filter.

Do NOT trust any generated filter registry.

Derive filters directly from:

database schema

repository queries

frontend usage

analytics engine

API consumers

Determine which filters are:

Core

Useful

Rare

Internal

Deprecated

Duplicate

Unused

---

# PHASE 4 — REMOVE DUPLICATES

Identify duplicate concepts such as:

statusCode vs status_code

duration vs latency

occurredAt vs timestamp

occurred_at

createdAt

ingestedAt

service vs appName

browser vs browserVersion

sdkName vs framework

etc.

Create one canonical field.

Remove aliases.

Update all backend code.

Update frontend.

Update documentation.

Update DTOs.

Update query builders.

Update repositories.

Update analytics.

Everything must use the canonical naming.

---

# PHASE 5 — DESIGN THE ENTERPRISE FILTER MODEL

Design filters exactly like enterprise observability products.

Every resource must have only filters that users actually use.

Avoid exposing database implementation details.

The API must not expose every column as a filter.

Instead classify filters into:

## Scope Filters

Always supported.

Example:

Environment

Time Range

Search

Pagination

Sorting

Organization and Project context

IMPORTANT:

Organization ID and Project ID must NOT be exposed as public query parameters.

These values are obtained from authenticated user context, selected organization, selected project, or server-side request context.

Frontend must never manually send organizationId.

Frontend must never manually send projectId.

Backend must resolve these automatically.

---

## Resource Filters

Requests

Errors

Logs

Metrics

Traces

Spans

Cron

Replays

Sessions

Each resource should expose only meaningful filters.

---

## Advanced Filters

Rarely used filters.

Keep supported by backend.

Expose only inside advanced filter UI.

---

## Internal Fields

Never expose:

Primary IDs

Internal timestamps

Storage metadata

Queue metadata

Partition metadata

Internal ingestion fields

Debug-only fields

Implementation-specific columns

Anything that leaks database implementation.

---

# PHASE 6 — QUERY PARAMETER STANDARDIZATION

Every GET endpoint must use the same conventions.

Example:

from

to

search

limit

cursor

sort

direction

environment

Only add resource-specific filters when appropriate.

No endpoint should invent different naming.

No duplicate parameter names.

No inconsistent casing.

No inconsistent timestamp naming.

---

# PHASE 7 — BACKEND OPTIMIZATION

Audit every repository query.

Remove:

dead joins

duplicate joins

unused conditions

duplicate WHERE clauses

N+1 queries

unused selected columns

SELECT *

unused ORDER BY

inefficient pagination

OFFSET pagination where cursor is better

non-indexed filters

unnecessary JSON extraction

duplicated repository logic

duplicated SQL

Replace with reusable query builders where appropriate.

Verify indexes exist for every supported filter.

Recommend composite indexes where needed.

Verify partition pruning.

Verify query plans.

Verify scalability.

---

# PHASE 8 — ANALYTICS ENGINE

Audit every analytics query.

Ensure analytics only use canonical fields.

Remove references to deleted columns.

Remove references to deprecated fields.

Verify:

aggregation

rollups

histograms

heatmaps

percentiles

time buckets

top endpoints

top services

status distribution

error distribution

latency distribution

Everything must remain functional after filter standardization.

---

# PHASE 9 — FRONTEND AUDIT

Audit every page under the Observability module.

Including but not limited to:

Overview

Requests

Errors

Traces

Logs

Metrics

Deployments

Cron

Sessions

Replays

Dashboards

Explorer

Analytics

Investigate every page.

Determine:

which endpoint it calls

which filters it supports

which filters are missing

which filters are broken

which filters are unused

which filters are duplicated

which filters are inconsistent

Every page must use the same filtering architecture.

---

# PHASE 10 — FILTER COMPONENTS

Frontend must use reusable filter components.

Do NOT build page-specific implementations.

Create shared components for:

Time Range

Environment

Search

Sorting

Pagination

Filter Builder

Advanced Filters

Saved Filters

URL Synchronization

Filter Chips

Clear Filters

Everything must be reusable.

---

# PHASE 11 — URL STATE

Ensure filters synchronize with URL.

Browser refresh must preserve state.

Back button must work correctly.

Deep links must restore filters.

Saved URLs must reproduce the same query.

---

# PHASE 12 — API CONTRACT CONSISTENCY

Every endpoint must have:

consistent pagination

consistent sorting

consistent error responses

consistent metadata

consistent naming

consistent filter serialization

consistent validation

consistent defaults

---

# PHASE 13 — SECURITY

Ensure:

Organization isolation is enforced server-side.

Project isolation is enforced server-side.

No client can access another organization's data.

Do not trust frontend-provided organization or project identifiers.

Validate all filter inputs.

Prevent SQL injection.

Prevent expensive wildcard searches.

Prevent unrestricted JSON queries.

Apply sane limits.

---

# PHASE 14 — PERFORMANCE

Evaluate:

Indexes

Partition pruning

Cursor pagination

Cache opportunities

Count query optimization

Aggregation performance

Large time range performance

JSON indexing

GIN indexes

Composite indexes

Memory allocations

Response size

Remove unnecessary work.

---

# PHASE 15 — FINAL DELIVERABLES

Produce:

1. Complete Observability architecture audit.
2. Database schema audit.
3. Table-by-table analysis.
4. Complete endpoint inventory.
5. Repository audit.
6. Query optimization report.
7. Duplicate field report.
8. Canonical field mapping.
9. Recommended public filter list per resource.
10. Internal-only field list.
11. Standard query parameter specification.
12. Frontend page audit.
13. Missing frontend filter report.
14. Backend/frontend consistency report.
15. Required code changes.
16. Migration plan.
17. Breaking change assessment.
18. Performance improvement recommendations.
19. Security findings.
20. Enterprise-grade implementation roadmap.

---

# IMPLEMENTATION REQUIREMENTS

Do not introduce unnecessary complexity.

Do not expose database internals.

Do not expose organizationId or projectId as public API filters.

Resolve organization and project context from authenticated session/server context.

Keep backend authoritative.

Keep frontend thin.

Every supported filter must:

* exist in the database
* be indexed when appropriate
* be supported by repositories
* be validated
* be documented
* be consumed by the frontend where relevant

Every frontend page must consume the standardized filter architecture.

The final result must be a clean, maintainable, scalable, enterprise-grade Observability platform with consistent backend APIs, consistent frontend behavior, optimized database queries, and a unified filtering model across the entire product.
