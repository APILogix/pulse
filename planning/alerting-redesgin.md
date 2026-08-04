1. Configuration Layer

This layer never evaluates alerts.

It only stores configuration.

Hierarchy:

Global Built-in Templates

↓

Organization Policies

↓

Project Subscription

↓

Project Overrides

↓

Effective Policy

Projects never duplicate rules.

Instead:

Organization Policy
      │
      ▼
Project Subscription
      │
      ▼
Override Threshold

Example

Organization

High Error Rate

Threshold = 5%

Cooldown = 15m

Project A

Subscribed

Threshold = 10%

Project B

Subscribed

Uses organization defaults
2. Policy Catalog

Every organization automatically gets:

Error Rate

Latency

P95

P99

Availability

Downtime

Request Volume

No Traffic

Cron Failure

Deployment Failure

OOM

Memory

CPU

Queue Backlog

Disk

Slow Database

Worker Failure

Webhook Failure

SDK Offline

Anomaly

SLO Burn Rate

Security Event

Authentication Failure

Rate Limit

Certificate Expiry

Custom Metrics

Each policy contains

ID

Slug

Version

Category

Metric Source

Expression

Default Threshold

Cooldown

Recovery Threshold

Severity

Documentation

Dependencies
3. Subscription Layer

Projects don't own rules.

Projects subscribe.

Organization Rule

↓

Project Subscription

↓

Overrides

Subscription states

Subscribed

Paused

Muted

Disabled

Archived
4. Override Layer

Allowed overrides

Threshold

Cooldown

Channels

Severity

Maintenance Windows

Evaluation Window

Environment

Escalation Policy

Mute Schedule

Not allowed

Expression

Metric

Aggregation

Rule Logic

Evaluation Strategy

5. Effective Configuration Resolver

Never duplicate configuration.

Runtime computes

Organization Policy

+

Project Override

=

Effective Policy
6. Signal Pipeline

Everything becomes a normalized signal.

SDK

↓

Kafka / Queue

↓

Signal Normalizer

↓

Internal Signal

↓

Evaluation

Supported

Request

Error

Log

Metric

Span

Trace

Cron

Profile

Replay

Heartbeat

AI Event

7. Evaluation Engine

Only ONE engine.

No legacy workers.

No duplicated evaluation.

Signal

↓

Find Matching Policies

↓

Resolve Effective Configuration

↓

Evaluate Expression

↓

Update State

↓

Generate Incident
8. Rule Expression Engine

Support

Threshold

Rate

Percentage

Moving Average

Window

Percentiles

Count

Ratio

Composite Rules

Boolean Expressions

Example

(error_rate > 5%)

AND

(requests > 100)

FOR

10 minutes

Support

AND

OR

NOT

Nested Groups

Parentheses

9. Alert State Machine

Every alert follows

Healthy

↓

Pending

↓

Triggered

↓

Acknowledged

↓

Escalated

↓

Muted

↓

Resolved

↓

Closed

No shortcuts.

Every transition audited.

10. Incident Correlation

Don't create 500 alerts.

Instead

Error Rate

↓

Fingerprint

↓

Existing Incident?

↓

Yes

↓

Update Incident

↓

No

↓

Create Incident
11. Deduplication

Fingerprint example

Organization

+

Project

+

Policy

+

Environment

+

Service

+

Dimension

=

Fingerprint

Duplicates increment

Occurrence Count

instead of creating alerts.

12. Suppression

Support

Maintenance Windows

Deployments

Silenced Services

Dependency Failures

Rate Limiting

Duplicate Suppression

Flapping Detection

13. Notification Pipeline
Incident

↓

Policy Routing

↓

Connector Selection

↓

Queue

↓

Connector Worker

↓

Provider

↓

Delivery Status

Never notify directly.

Everything uses queues.

14. Escalation Engine

Example

5 min

↓

Slack

↓

No Ack

↓

10 min

↓

Email

↓

No Ack

↓

PagerDuty

↓

No Ack

↓

Phone

Configurable.

15. Incident Timeline

Every incident stores

Created

Triggered

Recovered

Acknowledged

Escalated

Muted

Resolved

Closed

Every notification

Every retry

Every policy change

Every assignment

16. Evaluation Performance

Instead of polling

Every 5 Seconds

↓

Scan Database

Use

Telemetry

↓

Queue

↓

Signal Bus

↓

Evaluate Immediately

Windowed metrics are pre-aggregated.

Avoid scanning raw tables repeatedly.

17. Notification Idempotency

Every notification

Incident

+

Channel

+

Attempt

↓

Delivery Key

Connector workers use idempotency keys.

No duplicate Slack messages.

18. Multi-Tenant Isolation

Everything scoped

Organization

↓

Project

↓

Environment

↓

Service

No cross-tenant evaluation.

19. Database Design
alert_policy_templates

organization_alert_policies

organization_policy_versions

project_alert_subscriptions

project_policy_overrides

effective_policy_cache

alert_incidents

incident_occurrences

incident_state_history

incident_assignments

incident_comments

incident_tags

incident_muting

maintenance_windows

alert_notifications

notification_attempts

notification_dead_letter

notification_channels

escalation_policies

escalation_steps

alert_audit_logs

signal_dimensions

signal_snapshots

rule_expression_cache
20. Backend Services
AlertPolicyService

↓

PolicyResolverService

↓

SignalNormalizationService

↓

EvaluationEngine

↓

IncidentEngine

↓

DeduplicationEngine

↓

SuppressionEngine

↓

EscalationEngine

↓

NotificationEngine

↓

ConnectorDispatcher

↓

AuditService

Every service has one responsibility.

21. Worker Architecture
signal-consumer

evaluation-worker

incident-worker

notification-router

email-worker

slack-worker

discord-worker

pagerduty-worker

webhook-worker

recovery-worker

maintenance-window-worker

audit-worker

Workers should be stateless and horizontally scalable.

22. APIs

Organization

GET    /organizations/:id/alert-policies
POST   /organizations/:id/alert-policies
PATCH  /organizations/:id/alert-policies/:id
DELETE /organizations/:id/alert-policies/:id

Project

GET    /projects/:id/subscriptions
POST   /projects/:id/subscriptions
PATCH  /projects/:id/subscriptions/:id
DELETE /projects/:id/subscriptions/:id

Incident

GET    /incidents
GET    /incidents/:id
POST   /incidents/:id/acknowledge
POST   /incidents/:id/resolve
POST   /incidents/:id/mute
POST   /incidents/:id/assign
POST   /incidents/:id/comment
23. Enterprise Features
Organization-owned policy catalog with built-in and custom policies.
Project subscriptions with controlled overrides rather than copied rules.
Single evaluation engine to eliminate duplicate processing.
Dynamic effective-policy resolution at runtime.
Event-driven evaluation pipeline instead of repeated database polling.
Stateful incident lifecycle with acknowledgment, escalation, and recovery.
Fingerprint-based deduplication and incident correlation.
Maintenance windows, suppression rules, and anti-flapping logic.
Versioned policies, complete audit history, RBAC, and multi-tenant isolation.
Horizontally scalable stateless workers and idempotent notification delivery.
Extensible rule expression engine supporting thresholds, windows, composite conditions, and anomaly detection.

This architecture gives you a clean separation between configuration, evaluation, incident management, and notification delivery, making it easier to scale to enterprise workloads while avoiding the overlapping evaluation logic highlighted in your current audit.