Implement a complete Alerting Workspace Provisioning process that executes automatically whenever a new organization is created.

This is NOT limited to inserting default alert rules.

Instead, provision every configuration object required for the Alerting V2 platform while keeping runtime state empty.

The goal is that immediately after organization creation:

The entire Alerting UI works.
Every Alerting page loads from backend APIs.
No page depends on dummy data.
No page returns empty because required configuration is missing.
Runtime objects are not pre-created.
Critical Rules

Never create runtime state.

Only create configuration state.

Everything must be idempotent.

If organization creation retries, provisioning must not create duplicates.

Wrap provisioning in a transaction.

Rollback completely if provisioning fails.

Alerting Provisioning Flow
Organization Created

↓

Provision Alerting Workspace

↓

Seed Organization Policy Catalog

↓

Seed Categories

↓

Seed Policy Versions

↓

Seed Routing Defaults

↓

Seed Escalation Policies

↓

Seed Alert Settings

↓

Seed Maintenance Settings

↓

Seed Notification Defaults

↓

Seed Entitlements

↓

Seed Usage Counters

↓

Seed Connector Catalog Metadata

↓

Complete
1. Organization Alert Workspace

Create

Organization Alert Workspace

Fields

organization_id
created_at
updated_at
version
initialized_by
initialization_version
provisioning_status

This becomes the root object for Alerting.

2. Seed Organization Policy Catalog

Create all built-in organization policies.

Examples

High Error Rate

High Latency

P95 Latency

P99 Latency

Availability

Service Down

No Traffic

Cron Failure

Queue Backlog

OOM

Memory

CPU

Database Latency

Worker Failure

Webhook Failure

SDK Offline

Certificate Expiry

Rate Limit

Deployment Failure

Authentication Spike

SLO Burn Rate

Custom Metric Threshold

Anomaly Detection (if enabled)

Each policy includes

slug
name
description
category
severity
default threshold
recovery threshold
cooldown
evaluation window
enabled
version = 1
3. Seed Policy Categories

Create categories

Errors

Performance

Availability

Infrastructure

Security

Queues

Database

Deployments

Cron

SDK

Custom

AI

4. Seed Policy Versions

Every policy begins with

Version 1

Store immutable version records.

5. Seed Organization Routing Policies

Create default routing.

Example

Critical

↓

Email

High

↓

Email

Medium

↓

Dashboard

Low

↓

Dashboard

No connectors need to exist yet.

6. Seed Escalation Policies

Create default escalation chains.

Examples

Default

Critical

Production

Each policy contains

wait times
repeat intervals
acknowledgement timeout
cancellation rules
7. Seed Organization Alert Settings

Create

Timezone

Default Evaluation Window

Default Cooldown

Retention

Default Severity

Default Routing Policy

Default Escalation Policy

Maximum Incident Age

Digest Defaults

8. Seed Maintenance Configuration

Create

Global maintenance calendar

Default suppression settings

Default timezone

Recurring support enabled

No windows are created.

9. Seed Notification Defaults

Organization defaults

Email enabled

Digest enabled

Business hours

Quiet hours

Fallback notification behavior

These are defaults only.

10. Seed Connector Catalog Metadata

Do NOT create connectors.

Create only provider metadata.

Available providers

Slack

Discord

Teams

PagerDuty

Webhook

Email

SMS

Status

Not Configured

The organization installs connectors later.

11. Seed Connector Routing Defaults

Create empty routing records.

Example

Critical

↓

No connector selected

High

↓

No connector selected

The UI should still load correctly.

12. Seed Entitlements

Initialize

Maximum Policies

Maximum Connectors

Maximum Notifications

Maximum Escalations

Maximum Maintenance Windows

Maximum Custom Policies

Maximum SMS

Plan limits come from the subscription.

13. Seed Usage Counters

Initialize

Policies

Custom Policies

Project Subscriptions

Notifications

SMS

Connector Deliveries

Incidents

Maintenance Windows

Escalations

Everything begins at zero.

14. Seed Audit Root

Create

Alerting audit root

Workspace initialized event

Version

Timestamp

Provisioning version

15. Seed Feature Flags

Initialize

Alerting enabled

Policy simulation

Correlation

Maintenance

Escalation

Digest

Anomaly Detection

AI

Based on plan entitlements.

16. Seed Dashboard Configuration

Create default dashboard widgets.

Examples

Open Incidents

Critical Incidents

Policies

Notification Health

Connector Health

MTTR

MTTA

Alert Volume

The dashboard loads immediately.

17. Seed Saved Views

Create

All Incidents

Critical

Production

Acknowledged

Resolved

Open

No custom views.

18. Seed Search Index Configuration

Initialize search metadata.

Do not index incidents yet.

DO NOT CREATE

Never create

❌ Project subscriptions

❌ Effective policies

❌ Incidents

❌ Alert events

❌ Notification jobs

❌ Connector instances

❌ Slack workspaces

❌ PagerDuty services

❌ Email recipients

❌ Webhooks

❌ Runtime cache

❌ Delivery attempts

❌ Notification ledger entries

❌ Evaluation state

❌ Fingerprints

❌ Incident history

❌ Escalation executions

Everything above is created only when used.

Project Creation Behavior

When a project is created

Do NOT subscribe automatically.

Instead

Project

↓

Alerting Status

Not Configured

↓

Recommended Policies

↓

User chooses subscriptions

↓

Override configuration

↓

Effective policy generated

This prevents unnecessary policy evaluation.

Frontend Requirements

Every Alerting page must use backend APIs.

No hardcoded values.

No seed arrays inside React.

No dummy data.

No mocked policies.

No mocked incidents.

If data does not exist,

the backend must return initialized configuration created during organization provisioning.

API Verification

Verify every Alerting page loads correctly from backend APIs.

Examples

Organization Policies

Project Subscriptions

Effective Policies

Incidents

Escalations

Maintenance

Connector Catalog

Notification Defaults

Usage

Entitlements

Audit

Dashboard

No page should fail because initialization data is missing.

Transaction Requirements

Provisioning must be atomic.

If any provisioning step fails

Rollback everything.

No partial organizations.

Deliverables

Implement

Organization Alert Workspace provisioning
Seeded policy catalog
Policy categories
Policy version records
Routing defaults
Escalation defaults
Organization alert settings
Maintenance configuration
Notification defaults
Connector catalog metadata
Empty routing configuration
Entitlements
Usage counters
Audit root
Feature flags
Dashboard configuration
Saved views
Full transactional provisioning
Idempotent provisioning
Frontend verification ensuring every Alerting page consumes backend APIs and loads successfully without dummy data or manually seeded frontend state.

This gives you a clean separation between provisioned configuration (created once at organization creation) and runtime state (created only when organizations begin using alerting), which scales much better than eagerly creating subscriptions, incidents, or connector instances.