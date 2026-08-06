# Master Prompt: Audit Detail APIs & Modernize All Observability Detail Pages

## Objective

Perform a complete audit of every Observability Event Detail page and redesign them into modern, enterprise-grade investigation pages.

The frontend APIs are already implemented.

DO NOT create new backend APIs.

DO NOT change API contracts.

Your job is to analyze exactly what every existing Detail API returns and build the UI around the available data.

The existing detail endpoint is:

GET /api/v1/observability/:resource/:id

Example

GET /api/v1/observability/errors/:id
GET /api/v1/observability/requests/:id
GET /api/v1/observability/traces/:id
GET /api/v1/observability/logs/:id
GET /api/v1/observability/metrics/:id
GET /api/v1/observability/profiles/:id
GET /api/v1/observability/replays/:id
GET /api/v1/observability/checkins/:id

--------------------------------------------------------

# Phase 1 — API Audit

Before changing any UI:

Audit every detail endpoint.

For each resource determine

• every field returned
• nested objects
• metadata
• tags
• attributes
• timeline information
• timestamps
• correlations
• missing fields
• nullable fields
• arrays
• relationships

Do NOT ignore fields.

Produce an internal mapping

Backend Field

↓

Frontend Component

Every field returned by the backend should either

• be displayed
• be visualized
• be used for navigation
• be intentionally hidden with justification

Nothing should be unused.

--------------------------------------------------------

# Phase 2 — UI Modernization

Redesign every detail page.

Do NOT simply dump JSON.

Transform backend data into an enterprise investigation experience.

Design inspiration

• Sentry
• Datadog
• Grafana
• Linear
• Vercel
• GitHub

Modern dark theme

Large whitespace

Premium typography

SVG illustrations where appropriate

Status icons

Badges

Cards

Timelines

Copy buttons

Code blocks

Collapsible sections

Syntax highlighting

Progress indicators

Context panels

Responsive layout

Professional spacing

--------------------------------------------------------

# Global Layout

Every resource page should follow the same structure.

────────────────────────────────────────

Header

Overview Cards

Main Investigation Content

Metadata Sidebar

Related Resources

AI Panel

────────────────────────────────────────

--------------------------------------------------------

# Header

Large resource title

Resource type icon

Status badge

Severity badge (if applicable)

Environment badge

Service badge

Occurred At

Actions

Copy ID

Copy JSON

Open Raw Response

Export

Share

--------------------------------------------------------

# Overview Cards

Generate summary cards using backend data.

Examples

Duration

Status Code

Environment

Service

Release

SDK Version

Occurrences

Span Count

Profile Duration

Memory Usage

CPU Usage

Replay Length

Cron Status

Only display cards for fields actually returned.

--------------------------------------------------------

# Investigation Sections

Every page should intelligently organize information.

Never display raw JSON.

Examples

HTTP Information

Runtime

Performance

Trace

Exception

Stack Trace

Profile Summary

Replay Summary

Metric Statistics

Cron Execution

Request Information

Browser Information

Device Information

SDK Information

Application Information

Release Information

Context

Custom Tags

Metadata

Attributes

Events

Timeline

--------------------------------------------------------

# Sidebar

Sticky sidebar

Contains

Resource ID

Project

Environment

Service

SDK

Release

Created

Updated

Occurred

Quick Navigation

Related Links

Copy Actions

--------------------------------------------------------

# JSON Viewer

Never show raw JSON by default.

Instead

Pretty formatted viewer

Collapsible

Searchable

Copy JSON button

Syntax highlighting

--------------------------------------------------------

# Correlation

Automatically render links when IDs exist.

Examples

traceId

↓

Open Trace

requestId

↓

Open Request

errorGroupId

↓

Open Error Group

sessionId

↓

Open Replay

profileId

↓

Open Profile

Every correlated resource should be clickable.

--------------------------------------------------------

# Detail Page Requirements

==========================
ERROR
==========================

Overview

Message

Error Name

Severity

Handled

Status Code

Route

Environment

Stack Trace

Breadcrumbs

Context

Metadata

Related Trace

Related Request

Latest Release

SDK

AI Summary Card

--------------------------------------------------------

==========================
REQUEST
==========================

Overview

Endpoint

Method

Status

Duration

Environment

Headers

Query Parameters

Path Parameters

Request Body

Response Body

Timing

Related Trace

Related Error

Metadata

--------------------------------------------------------

==========================
TRACE
==========================

Overview

Timeline

Span Tree

Latency Breakdown

Root Span

HTTP Information

Attributes

Events

Linked Errors

Linked Logs

Metadata

--------------------------------------------------------

==========================
LOG
==========================

Overview

Log Message

Level

Timestamp

Context

Structured Metadata

Request Correlation

Trace Correlation

JSON Viewer

--------------------------------------------------------

==========================
METRIC
==========================

Overview

Metric Name

Current Value

Unit

Aggregation

Time Series Chart

Labels

Dimensions

Metadata

--------------------------------------------------------

==========================
PROFILE
==========================

Overview

Profile Type

Duration

Sample Count

CPU Summary

Memory Summary

Flamegraph Placeholder

Statistics

Metadata

--------------------------------------------------------

==========================
REPLAY
==========================

Overview

Session Information

Replay Timeline

Events

Browser

Viewport

Duration

Metadata

Replay Placeholder

--------------------------------------------------------

==========================
CRON CHECK-IN
==========================

Overview

Job Name

Status

Duration

Started

Finished

Environment

Execution Timeline

Metadata

--------------------------------------------------------

# Smart Rendering

Never show

null

undefined

empty arrays

empty objects

Instead

Hide empty sections completely.

Example

If

traceId == null

Hide

Related Trace

--------------------------------------------------------

# Field Formatting

Dates

Relative

+

Absolute

Durations

Human readable

Milliseconds

Microseconds

Bytes

KB

MB

GB

Status Codes

Colored badges

Booleans

Icons

Severity

Colored badges

Environment

Badges

IDs

Monospace

Copy button

--------------------------------------------------------

# SVG Empty States

Every section should have elegant SVG empty states.

Examples

No Stack Trace

No Metadata

No Related Trace

No Replay

No Profile

No Context

--------------------------------------------------------

# AI Panel

Every detail page should include

✨ Ask AI

Prompt examples

Explain this issue

Summarize this request

Analyze performance

Find bottlenecks

Explain stack trace

Recommend fixes

UI only.

No backend changes.

--------------------------------------------------------

# Performance

Lazy load heavy sections

Virtualize long stack traces

Virtualize span trees

Collapse metadata

Memoize expensive renders

Avoid unnecessary re-renders

--------------------------------------------------------

# Final Goal

Audit every existing Detail API response, ensure every useful backend field is surfaced appropriately, eliminate raw JSON dumps, and transform every Observability resource page into a polished, enterprise-grade investigation experience comparable to Sentry, Datadog, and Grafana while preserving the existing backend API contracts exactly.