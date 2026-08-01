# MASTER IMPLEMENTATION PROMPT
# ENTERPRISE OBSERVABILITY EXPLORER PLATFORM
# (BACKEND FIRST → FRONTEND SECOND)

You are the lead software architect for Pulse.

This is NOT simply a CRUD implementation.

We are building an enterprise-grade observability platform comparable to:

- Datadog
- Grafana Cloud
- New Relic
- Sentry
- Elastic Observability
- Honeycomb

The existing ingestion pipeline, analytics pipeline and hybrid alerting architecture already exist.

This task focuses ONLY on the Observability Explorer Platform.

The frontend should NEVER assemble telemetry.

The backend owns correlation.

The frontend only renders.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRIMARY GOAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Design and implement the complete Observability Explorer Platform.

This includes:

• Backend architecture

• API contracts

• Explorer APIs

• Detail APIs

• Live APIs

• AI APIs

• Analytics APIs

• Sidebar redesign

• Frontend redesign

Everything must follow enterprise standards.

Do NOT immediately create controllers.

Do NOT immediately create routes.

Architecture first.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1
INFORMATION ARCHITECTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

First redesign the entire Observability navigation.

The final sidebar should resemble enterprise monitoring platforms.

Example:

Overview

Live

    Requests

    Errors

    Logs

    Traces

    Spans

    Metrics

    Cron Check-ins

    Profiles

Analytics

    Dashboard

    Services

    Endpoints

    Databases

    External APIs

    AI Insights

    Correlations

    Trends

Deployments

Releases

Alerting

Settings

Do not copy Datadog.

Create the best enterprise UX.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 2
PAGE INVENTORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

List every page.

For every page define:

Purpose

Primary data

Secondary data

Live updates

Filters

Actions

Charts

Tables

AI features

Permissions

Empty state

Loading state

Error state

Every page must have a proper responsibility.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 3
COMMON EXPLORER FRAMEWORK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every explorer page must share the same framework.

Header

Search

Time Range

Environment

Project

Saved Views

Filters

Columns

Pagination

Sorting

Export

Share

Bookmarks

Ask AI

Live Toggle

Auto Refresh

No page should invent its own UX.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 4
BACKEND API CONTRACTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before implementation define every API.

Use REST.

Every resource must expose:

GET List

GET Detail

GET Summary

GET Statistics

GET Timeline

GET Related

POST Ask AI

Every API contract must be documented.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 5
REQUEST EXPLORER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create complete APIs.

List

Detail

Summary

Timeline

Statistics

Related Data

Request List Columns:

Project Name

Environment

Method

URL

Route

Status Code

Latency

Timestamp

Duration

Request Size

Response Size

Trace ID

Request ID

User

Release

SDK Version

Country

Browser

OS

Device

IP

Has Error

Has Logs

Has Trace

Has Replay

Has Profile

Every row includes:

Ask AI

Open Trace

Open Logs

Open Error

Open Replay

Open Profile

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUEST FILTERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Time

Environment

Project

Method

Status

Latency

URL

Route

User

Country

Browser

OS

Device

Release

SDK Version

Tags

Search

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUEST DETAIL PAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Backend returns one payload.

summary

request

trace

spanTree

metrics

logs

relatedErrors

relatedDeployments

relatedReplays

relatedProfiles

timeline

network

headers

body

cookies

attributes

tags

correlations

aiContext

Frontend performs ZERO joins.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 6
ERROR EXPLORER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

List

Detail

Timeline

Grouping

Fingerprint

Stack Trace

Source Code

Request

Trace

Logs

Metrics

Breadcrumbs

Deployments

Releases

Sessions

Affected Users

AI Explanation

Filters:

Severity

Handled

Unhandled

Fingerprint

Environment

Release

SDK

Exception

Tags

Assigned

Resolved

Project

Ask AI available everywhere.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 7
TRACE EXPLORER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

List traces.

Trace detail returns:

Summary

Root Span

Nested Span Tree

Timeline

Waterfall

Critical Path

Service Graph

Request

Logs

Metrics

Errors

Dependencies

Database Calls

HTTP Calls

AI Analysis

Backend returns nested span tree.

Frontend renders graph.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 8
SPAN EXPLORER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

List spans.

Detail

Parent

Children

Attributes

Duration

Events

Exceptions

Linked Request

Linked Trace

Linked Logs

AI Analysis

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 9
LOG EXPLORER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Enterprise log viewer.

Filters:

Level

Service

Logger

Environment

Trace

Span

Request

Source

Search

Tags

Time

Actions:

Ask AI

Open Trace

Open Request

Open Span

Open Error

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 10
METRICS EXPLORER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Metric explorer.

Charts

Rollups

Aggregation

Tags

Percentiles

Time Series

Top Dimensions

Ask AI

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 11
CRON CHECK-IN EXPLORER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

List

Status

Runtime

Schedule

Last Success

Failures

Missed Runs

Timeline

AI Analysis

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 12
PROFILE EXPLORER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CPU

Memory

Hot Paths

Functions

Call Graph

Flamegraph

Allocations

Thread Usage

AI Suggestions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 13
LIVE OBSERVABILITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create dedicated Live pages.

Live Requests

Live Errors

Live Logs

Live Traces

Live Cron

Live Metrics

Live Profiles

Support:

Pause

Resume

Auto Scroll

Buffer

Reconnect

Bookmarks

Filters

Search

Ask AI

Use WebSocket or SSE.

Do not use polling.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 14
UNIVERSAL EVENT DETAIL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every event detail page follows one layout.

Summary

Timeline

Metadata

Attributes

Tags

Relationships

Trace

Logs

Metrics

Related Events

Deployments

Releases

AI Investigation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 15
AI INTEGRATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every explorer row must include:

Ask AI

Every detail page must include:

Explain

Find Root Cause

Find Similar Events

Performance Analysis

Security Analysis

Optimization Suggestions

Generate Incident Summary

AI NEVER fetches frontend state.

Backend assembles context.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 16
BACKEND CORRELATION ENGINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Backend is responsible for correlating:

Requests

Errors

Logs

Traces

Spans

Metrics

Profiles

Cron Check-ins

Deployments

Releases

Users

Sessions

Everything returned as one payload.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 17
ANALYTICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Do NOT calculate analytics during page requests.

Create analytics workers.

Analytics workers populate rollup tables.

Dashboards read rollups only.

Never query billions of events.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 18
PERMISSIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every endpoint respects:

Organization

Project

Environment

Role

Permission

Plan

Feature

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 19
IMPLEMENTATION ORDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO NOT immediately build controllers.

Follow this order.

1.

Design Information Architecture

2.

Design Explorer Framework

3.

Design API Contracts

4.

Design Response Models

5.

Design Database Queries

6.

Design AI Contracts

7.

Implement Services

8.

Implement Repositories

9.

Implement Controllers

10.

Implement Routes

11.

Implement WebSockets

12.

Implement Frontend

13.

Implement AI

14.

Performance Optimization

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 20
PERFORMANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Support:

Cursor Pagination

Streaming

Compression

Selective Loading

Field Projection

Lazy Relationships

Caching

Indexes

Materialized Rollups

Batch Queries

Avoid N+1

Support millions of events.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUCCESS CRITERIA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The final platform should feel like an enterprise observability product.

Backend owns:

Business Logic

Correlation

Aggregation

Relationships

Context Assembly

Frontend owns:

Presentation

Interaction

Visualization

Everything must be scalable, AI-ready, and production-grade.

Never create placeholder implementations.

Never leave TODOs.

Every page should be immediately usable by real customers.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 4
UNIFIED EXPLORER QUERY ENGINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before implementing any backend route, design and build a Unified Explorer Query Engine.

This becomes the shared query layer for every observability explorer.

Do NOT allow every controller or service to build its own SQL queries.

Every explorer must use the same query engine.

The goal is to eliminate duplicated filtering, searching, sorting, pagination, validation, and query-building logic.

The Query Engine must be generic, extensible, and reusable across every telemetry resource.

Supported explorers include:

• Requests
• Errors
• Logs
• Traces
• Spans
• Metrics
• Cron Check-ins
• Profiles
• Session Replay (future)
• Runtime Metrics (future)
• Event Loop Monitoring (future)
• Garbage Collection Monitoring (future)
• AI Investigations

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMMON FILTERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every explorer automatically supports:

Organization

Project

Environment

Time Range

Search

Tags

Release

SDK Version

Cursor Pagination

Sorting

Saved Views

Pinned Filters

Bookmarks

Limit

Direction

Field Projection

Live Mode

Every explorer inherits these automatically.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESOURCE-SPECIFIC FILTERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Each explorer only adds its own filters.

Examples

Requests

• Method

• URL

• Route

• Status Code

• Latency

• User

• Country

• Browser

• Device

Errors

• Severity

• Fingerprint

• Handled

• Exception Type

• Error Group

• Assigned User

• Resolution State

Logs

• Level

• Logger

• Source

• Message

• Service

• Trace ID

Traces

• Duration

• Root Span

• Operation

• Service

• Sampling

Metrics

• Metric Name

• Aggregation

• Percentile

• Unit

Cron

• Job

• Status

• Runtime

• Schedule

Profiles

• CPU

• Memory

• Thread

• Function

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUERY ENGINE RESPONSIBILITIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The Query Engine is responsible for:

Query validation

Filter validation

SQL generation

Index-aware query planning

Cursor pagination

Sorting

Search parsing

Column projection

Aggregations

Summary statistics

Permission filtering

Environment filtering

Project filtering

Organization filtering

Tenant isolation

It must never expose raw SQL construction inside controllers.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIELD PROJECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Allow clients to request only required fields.

Example

fields=id,method,url,status,latency

Do not return unnecessary payloads.

Support lightweight tables and rich detail pages using the same endpoint.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURSOR PAGINATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Do not use OFFSET pagination.

Implement stable cursor pagination.

Support:

nextCursor

previousCursor

forward

backward

Time-based cursors

ID-based cursors

Pagination must remain performant on billions of rows.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEARCH ENGINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Support full-text search across supported fields.

Examples

status:500

method:POST

service:auth

trace:abc123

error:TimeoutError

url:/api/login

latency>1000

environment:production

project:backend

Allow combining filters.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INDEX-AWARE QUERY PLANNER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The Query Engine must understand database indexes.

Avoid full-table scans.

Choose efficient query paths.

Recommend indexes when required.

Support partition pruning.

Support BRIN indexes for time-series tables.

Support GIN indexes where appropriate.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUMMARY GENERATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every list endpoint should automatically return:

Items

Pagination

Summary

Statistics

Applied Filters

Available Filters

Aggregation Metadata

Do not require additional summary endpoints.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUERY CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every request automatically resolves:

Organization

Project

Environment

Role

Permissions

Plan

Timezone

Retention Window

Feature Flags

Controllers should never manually resolve these repeatedly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OBSERVABILITY QUERY DSL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Design an internal Query DSL used by every explorer.

Example

RequestQuery

ErrorQuery

TraceQuery

LogQuery

MetricQuery

CronQuery

The Query Engine translates DSL → SQL.

Never allow controllers to manually concatenate SQL.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SAVED SEARCHES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Support reusable saved queries.

Examples

My Production Errors

Critical Requests

Slow APIs

Database Timeouts

AI Investigations

Saved searches should work across all explorers.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXTENSIBILITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Adding a new explorer should require only:

Repository

Mapping

Resource-specific filters

Response model

The Query Engine should automatically provide:

Filtering

Pagination

Sorting

Searching

Projection

Permissions

Aggregation

Statistics

No duplicated implementation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESIGN REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The Unified Explorer Query Engine should become the single backend entry point for querying observability data.

Every explorer must depend on it.

No controller should directly build SQL.

No duplicated pagination logic.

No duplicated filtering logic.

No duplicated search logic.

No duplicated sorting logic.

Optimize for:

Maintainability

Performance

Scalability

Reusability

Enterprise-grade consistency.