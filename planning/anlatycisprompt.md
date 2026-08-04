# MASTER PROMPT
# ENTERPRISE ANALYTICS ENGINE
# (FRONTEND → ANALYTICS → BACKEND)

DO NOT START IMPLEMENTATION IMMEDIATELY.

Your first responsibility is understanding the existing system.

This task is NOT about writing workers.

This task is about designing the complete Analytics Engine that powers the frontend dashboards.

Think like the architects of:

• Datadog

• Grafana Cloud

• New Relic

• Elastic Observability

• Honeycomb

======================================================================
PRIMARY GOAL
======================================================================

Analyze the ENTIRE frontend.

Understand every dashboard.

Understand every page.

Understand every chart.

Understand every table.

Understand every dummy dataset.

Then design analytics workers that continuously generate exactly the data required by the frontend.

The frontend must NEVER calculate analytics.

Controllers must NEVER perform expensive aggregations.

Everything should come from Analytics Workers.

======================================================================
PHASE 1
COMPLETE FRONTEND AUDIT
======================================================================

Inspect the entire frontend.

Analyze:

Dashboard pages

Overview pages

Project pages

Analytics pages

Widgets

Cards

Graphs

Heatmaps

Timelines

Tables

Charts

Activity feeds

AI widgets

KPI cards

Progress bars

Every component.

Do NOT skip any page.

======================================================================
PHASE 2
EXTRACT FRONTEND CONTRACT
======================================================================

For EVERY page document:

Purpose

Widgets

Charts

Tables

KPIs

Dummy Data

Placeholder Data

Required Backend Data

Refresh Frequency

Live vs Historical

Time Filters

Environment Filters

Project Filters

Search

Sorting

Pagination

Relationships

Actions

Ask AI

Export

Everything.

Build a complete frontend data contract.

======================================================================
PHASE 3
REMOVE DUMMY DATA
======================================================================

Locate every:

mock

dummy

fake

sample

hardcoded

temporary

analytics dataset.

Document:

Component

Current Dummy Data

Expected Real Data

Telemetry Source

Analytics Worker

Rollup Table

Backend API

Do not leave any dummy analytics in the application.

======================================================================
PHASE 4
AUDIT LOG DB
======================================================================

Inspect ALL Log DB tables.

Inspect every migration.

Inspect every partition.

Inspect every telemetry table.

Inspect every runtime table.

Inspect every analytics table.

Inspect canonical migrations.

Document:

Purpose

Indexes

Relationships

Retention

Partitioning

Data Ownership

Read Frequency

Write Frequency

Consumers

Do NOT guess.

======================================================================
PHASE 5
METRIC DISCOVERY
======================================================================

Identify every metric already available.

Examples

Requests

Errors

Logs

Traces

Spans

Metrics

Profiles

Cron Check-ins

Replay

SDK Usage

Countries

Browsers

Devices

OS

Latency

P95

P99

Availability

Traffic

Top Routes

Top Services

Top Endpoints

Top Errors

Top Users

Sessions

Everything.

Then determine:

Missing Metrics

Duplicate Metrics

Unused Metrics

Expensive Metrics

======================================================================
PHASE 6
DASHBOARD OPTIMIZATION
======================================================================

Review every dashboard.

Determine whether it should be improved.

Recommend:

Removing unnecessary widgets

Adding missing enterprise widgets

Simplifying layouts

Adding better charts

Adding AI insights

Adding correlations

Improving usability

Reducing duplicate information

If dashboards should change,

update both frontend requirements and analytics architecture.

======================================================================
PHASE 7
DESIGN ANALYTICS WORKERS
======================================================================

ONLY NOW begin worker design.

Workers must be domain based.

Examples

analytics.requests

analytics.errors

analytics.logs

analytics.traces

analytics.spans

analytics.metrics

analytics.crons

analytics.profiles

analytics.services

analytics.endpoints

analytics.users

analytics.geo

analytics.sdk

analytics.deployments

analytics.releases

analytics.billing

analytics.usage

analytics.alerts

analytics.ai

analytics.slo

analytics.apdex

analytics.capacity

Do NOT build one giant analytics worker.

======================================================================
PHASE 8
FOR EVERY ANALYTICS WORKER
======================================================================

Document:

Purpose

Input Events

Source Tables

Output Tables

Refresh Frequency

Aggregation Windows

Indexes

Consumers

Dashboard Pages

Charts

Widgets

Alert Dependencies

AI Dependencies

Scaling

Retry Strategy

Idempotency

Health Checks

Failure Recovery

======================================================================
PHASE 9
ANALYTICS ARCHITECTURE
======================================================================

Analytics Workers MUST:

Read ONLY from Log DB.

Never read telemetry from Primary DB.

Never run inside Ingestion Workers.

Never block ingestion.

Workers run independently.

Architecture:

Telemetry

↓

Log DB

↓

Analytics Workers

↓

Analytics Rollups

↓

Dashboard APIs

↓

Frontend

Analytics workers are completely independent from ingestion.

======================================================================
PHASE 10
ROLLUP TABLES
======================================================================

Design optimized analytics tables.

Every worker writes only to its own rollups.

Examples

request_metrics_1m

request_metrics_5m

request_metrics_1h

request_metrics_1d

error_metrics_1m

trace_metrics_1m

service_metrics_1m

endpoint_metrics_1m

cron_metrics_1m

profile_metrics_1m

usage_metrics_1d

billing_metrics_1d

ai_metrics_1h

No dashboard should aggregate raw telemetry.

======================================================================
PHASE 11
BACKEND ROUTES
======================================================================

Implement backend APIs.

The frontend should receive exactly the data required.

No frontend joins.

No frontend aggregation.

Every dashboard API returns:

Cards

Charts

Tables

Graphs

Comparisons

Trend Lines

AI Context

Pagination

Everything already formatted.

======================================================================
PHASE 12
DO NOT TOUCH INGESTION
======================================================================

Analytics Workers must NOT be integrated into:

Ingestion API

Ingestion Workers

Telemetry validation

Telemetry normalization

Ingestion queues

Analytics is a completely separate subsystem.

======================================================================
PHASE 13
WORKER REGISTRATION
======================================================================

Create a dedicated Analytics Worker process.

Register all analytics workers there.

Do NOT register them inside ingestion workers.

Workers should have:

Health endpoint

Metrics endpoint

Retry handling

Graceful shutdown

Independent scaling

Independent concurrency

======================================================================
PHASE 14
IMPLEMENTATION
======================================================================

Implement:

Repositories

Services

Workers

Queue Registration

Rollup Writers

Dashboard APIs

Health Checks

Metrics

Tests

No placeholder code.

======================================================================
PHASE 15
DOCUMENTATION
======================================================================

Create complete documentation.

Create:

docs/analytics/

Include:

Architecture Overview

Worker Architecture

Queue Topology

Rollup Tables

Dashboard Dependency Graph

Frontend Data Contracts

Metric Definitions

Aggregation Windows

Worker Responsibilities

Scaling Strategy

Retry Strategy

Failure Recovery

API Documentation

Database Ownership

Sequence Diagrams

Flow Diagrams

Implementation Guide

Future Expansion

This documentation should be sufficient for a new engineer to understand the entire analytics subsystem.

======================================================================
SUCCESS CRITERIA
======================================================================

Every dashboard is powered entirely by Analytics Workers.

Every dummy dataset is removed.

Every expensive calculation is precomputed.

Analytics Workers are independent from ingestion.

Analytics Workers only use Log DB.

Frontend becomes a presentation layer.

Backend owns analytics.

Architecture is enterprise-grade.

Code is production-ready.

No TODOs.

No placeholders.

No dead code.
======================================================================
PHASE 16
ANALYTICS DEPENDENCY MATRIX
======================================================================

After completing the analytics architecture, generate a complete Analytics Dependency Matrix.

This matrix becomes the single source of truth for the entire analytics subsystem.

Every frontend widget must map to exactly one analytics source.

Document for every widget:

Dashboard

↓

Widget

↓

Backend API

↓

Analytics Worker

↓

Rollup Table

↓

Source Telemetry Tables

↓

Source Event Types

↓

Refresh Frequency

↓

Aggregation Window

↓

Alert Dependencies

↓

AI Dependencies

Example

Project Dashboard

↓

Request Rate Card

↓

GET /analytics/projects/:id

↓

analytics.requests

↓

request_metrics_1m

↓

events_requests

↓

Request Events

↓

5 seconds

↓

1 minute

↓

High Request Rate Alert

↓

Traffic Trend AI

Every widget in the frontend must appear in this matrix.

Nothing should remain undocumented.

======================================================================
PHASE 17
ANALYTICS CATALOG
======================================================================

Create a complete Analytics Catalog.

Every metric used by the platform must be documented.

For every metric define:

Metric Name

Description

Business Meaning

Formula

Aggregation

Dimensions

Units

Source Tables

Source Event Types

Worker Owner

Rollup Table

Consumers

Dashboard Usage

Alert Dependencies

AI Dependencies

Retention

Refresh Frequency

Examples

Request Rate

Error Rate

Latency P50

Latency P95

Latency P99

Apdex

Availability

Traffic

Throughput

Error Groups

Top Endpoints

Top Services

Top Databases

Cron Success

Cron Failure

Average Response Size

Average Request Size

SDK Usage

Countries

Browsers

Operating Systems

Devices

Unique Users

Sessions

Release Adoption

Deployment Success

Billing Usage

AI Credits

AI Cost

Everything must have a single documented definition.

Never allow duplicate definitions.

======================================================================
PHASE 18
ANALYTICS LINEAGE GRAPH
======================================================================

Generate a complete lineage graph for every metric.

Every dashboard value must be traceable.

Example

Telemetry Event

↓

events_requests

↓

analytics.requests

↓

request_metrics_1m

↓

Project Dashboard

↓

Request Rate Card

↓

AI Summary

↓

High Request Rate Alert

Every number displayed to the user should be traceable back to the original telemetry event.

Produce lineage diagrams.

======================================================================
PHASE 19
ANALYTICS COVERAGE REPORT
======================================================================

Produce a coverage report.

Identify:

Frontend widgets without analytics.

Analytics workers without consumers.

Unused rollup tables.

Duplicate metrics.

Duplicate workers.

Expensive calculations.

Missing metrics.

Missing rollups.

Missing APIs.

Missing indexes.

Missing charts.

Missing AI integrations.

Missing alert integrations.

For every issue provide:

Current State

Recommended Fix

Priority

Expected Impact

======================================================================
PHASE 20
ANALYTICS QUALITY REVIEW
======================================================================

Review the completed analytics architecture.

Evaluate:

Correctness

Scalability

Maintainability

Performance

Storage Efficiency

Worker Isolation

Queue Design

Database Design

Rollup Design

Dashboard UX

API Design

AI Readiness

Alert Integration

Rate the architecture from 1–10 for:

Enterprise Readiness

Scalability

Performance

Observability

Developer Experience

Operational Simplicity

Future Extensibility

Identify every remaining weakness before implementation.

======================================================================
FINAL REQUIREMENT
======================================================================

Do NOT implement workers until ALL of the following artifacts have been generated and approved:

✓ Frontend Dashboard Audit

✓ Dashboard Optimization Report

✓ Dummy Data Audit

✓ Log DB Audit

✓ Canonical Migration Audit

✓ Analytics Worker Design

✓ Rollup Table Design

✓ Dashboard API Contracts

✓ Analytics Dependency Matrix

✓ Analytics Catalog

✓ Analytics Lineage Graph

✓ Analytics Coverage Report

✓ Architecture Review

✓ Implementation Roadmap

Only after all documentation is complete and internally consistent should implementation begin.

The implementation must exactly follow the approved analytics architecture.

No undocumented worker may be created.

No undocumented metric may exist.

No dashboard may consume data that is not represented in the Analytics Dependency Matrix.
The honest caveat
 
  Nothing has been executed. This environment gives me no command-execution tool, so I verified by inspection against your strict tsconfig  
  (noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax). That inspection caught four real bugs — most importantly a  
  trailing SQL line comment that would have commented out every ON CONFLICT clause, and a non-idempotent error-group counter that would have
  inflated counts on replay.
 
  Run these next, in order: npx tsc --noEmit, npm test, npm run test:integration -- analytics-engine-migrations. All 13 deviations from the 
  design are recorded in docs/analytics/DEVIATIONS.md, and docs/analytics/PROGRESS.md has a "start here" section for the remaining work (8  
  workers, then the frontend migration).