# Master Prompt: Phase 2 Enterprise Automation Backend

You are Codex working in the Pulse backend repository.

Your task is to implement enterprise automation as a dedicated backend module. Automation workflows must not be modeled as alert rules. Alert rules detect conditions and create alert events. Automation workflows orchestrate triggers, conditions, approvals, actions, retries, and audit trails across observability, alerting, billing, AI, connectors, incidents, releases, and operations.

Do not directly start implementation until you have read the existing code and schemas listed in this prompt.

## Repository Context

Backend root:

```text
C:\Users\vikas\OneDrive\Desktop\SaasBackend\pulse
```

Canonical migration draft root:

```text
src/db/postgres/canonical_migrations_draft
```

Existing billing seed:

```text
src/db/postgres/canonical_migrations_draft/11_billing/026_enterprise_module_billing_seed.sql
```

Existing frontend gap docs:

```text
docs/billing-enterprise-seed-diff.md
docs/frontend-pages-required-from-enterprise-billing-seed.md
```

## Required First Step

Read and analyze these areas before editing:

```text
src/db/postgres/canonical_migrations_draft/00_shared
src/db/postgres/canonical_migrations_draft/04_projects
src/db/postgres/canonical_migrations_draft/06_connectors
src/db/postgres/canonical_migrations_draft/08_alerting
src/db/postgres/canonical_migrations_draft/09_audit
src/db/postgres/canonical_migrations_draft/11_billing
src/db/postgres/canonical_migrations_draft/14_observability
src/db/postgres/canonical_migrations_draft/15_analytics
src/db/postgres/canonical_migrations_draft/18_ai
src/modules/alerting
src/modules/connectors
src/modules/billing
src/modules/event-analytics
src/modules/ai
src/modules/organization
src/modules/projects
src/shared/middleware
src/shared/errors
src/shared/workers
```

Use `rg` for code search. Do not rely on assumptions about route style, response shape, or repository patterns.

## High-Level Goal

Implement a dedicated enterprise automation module that supports:

- Workflow definitions.
- Workflow versions.
- Triggers.
- Conditions.
- Actions.
- Runs.
- Run steps.
- Approvals.
- Templates.
- Template versions.
- Audit logs.
- Idempotent event ingestion.
- Retry policies.
- Deduplication.
- Rate limits and concurrency controls.
- Safe human approval gates.
- Enterprise-scale query patterns.

The module must be organization-scoped for customer automation, with optional platform-owned templates managed by super admin.

## Core Rule

Alert Rules are not Automation Workflows.

Alert rules:

- Detect telemetry or alert conditions.
- Evaluate thresholds.
- Produce alert events.
- Own alert-specific route/evaluation state.

Automation workflows:

- React to events from alerting, observability, billing, AI, connectors, releases, security, or schedules.
- Orchestrate multi-step actions.
- Require approvals for risky actions.
- Keep run history.
- Retry failed steps.
- Execute idempotently.
- Maintain auditability.

Do not merge automation tables into existing alerting tables.

## Ownership Model

Organization users/admins should manage organization-level workflows:

- Alert routing automation.
- Escalation automation.
- Incident creation automation.
- Incident timeline automation.
- Postmortem automation.
- Release guard automation.
- Rollback recommendation automation.
- Noise reduction automation.
- Remediation workflow automation.
- Runbook automation.
- Connector automation.
- Data retention automation.
- Quota automation.
- Anomaly automation.
- Dead-letter automation.
- Security automation.
- Report automation.

Super admin should manage platform-level controls:

- Global default automation templates.
- Template publication.
- Allowed action registry.
- Dangerous action policy.
- Platform safety guardrails.
- Feature/plan availability through billing entitlements.
- System-level audit access.

## Automation Types To Support

Support these automation types as first-class template categories and workflow metadata:

```text
alert_routing
escalation
incident_creation
incident_timeline
postmortem
release_guard
rollback_recommendation
noise_reduction
remediation
runbook
connector
data_retention
quota
anomaly
dead_letter
security
report
custom
```

## Workflow Triggers To Support

Implement trigger records generically using `trigger_type`, `source`, and `config` JSONB.

Minimum trigger types:

```text
alert.event.created
alert.event.acknowledged
alert.event.resolved
alert.event.escalated
alert.rule.firing
error.group.created
error.group.regressed
trace.latency.baseline_breached
log.pattern.spike
metric.threshold_breached
cron.missed
uptime.failed
slo.burn_rate_breached
release.deployed
release.health_degraded
ai.root_cause.confidence_breached
billing.usage.threshold_breached
billing.plan.changed
connector.delivery.failed
connector.delivery.dead_lettered
billing.webhook.dead_lettered
ingestion.dead_letter.created
security.api_key.suspicious_usage
security.sso.failed_spike
security.scim.failed_spike
security.export.spike
schedule.cron
manual.run
webhook.received
```

Do not assume all source modules already emit these events. Build the automation schema so they can be added incrementally. Implement service entrypoints for creating a run from a trigger event even if some emitters are added later.

## Workflow Actions To Support

Implement action records generically using `action_type`, `integration_key`, `config`, `requires_approval`, and `risk_level`.

Minimum action types:

```text
notification.send
incident.create
incident.assign_owner
incident.timeline.append
incident.postmortem.generate_draft
ticket.github.create
ticket.jira.create
pagerduty.trigger
runbook.open
runbook.step.create
status_page.update
approval.request
connector.delivery.retry
alert.severity.change
alert.silence.create
ai.summary.generate
ai.root_cause.generate
report.export
rollback.recommend
release.guard.warn
release.guard.pause
quota.notify
quota.throttle_recommend
retention.archive
retention.purge_request
security.notify
webhook.call
noop
```

Dangerous actions must require approval by default:

```text
release.guard.pause
retention.purge_request
quota.throttle_recommend
status_page.update
webhook.call when external URL is not allowlisted
```

Do not implement destructive rollback execution in this phase. Only implement rollback recommendation and approval workflow scaffolding.

## Required Migration Folder

Create a new canonical migration draft folder after AI because automation depends on billing, alerting, connectors, observability, and AI:

```text
src/db/postgres/canonical_migrations_draft/19_automation
```

Use numbered SQL files:

```text
001_automation_enums.sql
002_automation_workflows.sql
003_automation_workflow_versions.sql
004_automation_triggers.sql
005_automation_conditions.sql
006_automation_actions.sql
007_automation_runs.sql
008_automation_run_steps.sql
009_automation_approvals.sql
010_automation_templates.sql
011_automation_template_versions.sql
012_automation_events_inbox.sql
013_automation_audit_logs.sql
014_automation_indexes_and_views.sql
015_automation_default_templates_seed.sql
```

Every migration must be idempotent.

Use `CREATE TABLE IF NOT EXISTS`.

Use `CREATE INDEX IF NOT EXISTS`.

Use guarded enum creation.

Use `ON CONFLICT` in seeds.

Do not create sample organizations.

Do not create customer workflows in the seed. Seed templates only.

## Required Enums

Create enums only if they do not exist.

Suggested enums:

```sql
automation_workflow_status:
  draft
  active
  paused
  archived
  disabled

automation_workflow_scope:
  organization
  project
  platform

automation_template_scope:
  platform
  organization

automation_trigger_kind:
  event
  schedule
  manual
  webhook

automation_condition_operator:
  eq
  neq
  gt
  gte
  lt
  lte
  in
  not_in
  contains
  not_contains
  matches
  exists
  not_exists
  between

automation_action_risk:
  low
  medium
  high
  critical

automation_run_status:
  queued
  running
  waiting_approval
  succeeded
  failed
  cancelled
  skipped
  timed_out

automation_step_status:
  queued
  running
  waiting_approval
  succeeded
  failed
  skipped
  cancelled
  timed_out

automation_approval_status:
  pending
  approved
  rejected
  expired
  cancelled

automation_audit_action:
  workflow.created
  workflow.updated
  workflow.enabled
  workflow.disabled
  workflow.paused
  workflow.archived
  workflow.version_published
  trigger.received
  run.queued
  run.started
  run.completed
  run.failed
  run.cancelled
  step.started
  step.completed
  step.failed
  approval.requested
  approval.approved
  approval.rejected
  template.created
  template.published
```

If PostgreSQL enum labels cannot contain dots in this codebase style, use snake_case instead. Prefer consistency with existing migrations.

## Table: automation_workflows

Purpose:

- Customer-created workflow identity and lifecycle.
- One workflow can have multiple versions.
- Only active published version runs.

Columns:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE
project_id UUID NULL REFERENCES projects(id) ON DELETE CASCADE
created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL
updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL
template_id UUID NULL
name VARCHAR(150) NOT NULL
slug VARCHAR(150) NOT NULL
description TEXT
workflow_type VARCHAR(80) NOT NULL
scope automation_workflow_scope NOT NULL DEFAULT 'organization'
status automation_workflow_status NOT NULL DEFAULT 'draft'
is_enabled BOOLEAN NOT NULL DEFAULT FALSE
current_version INTEGER NOT NULL DEFAULT 1
last_run_at TIMESTAMPTZ
next_run_at TIMESTAMPTZ
timezone VARCHAR(80) NOT NULL DEFAULT 'UTC'
tags TEXT[] NOT NULL DEFAULT '{}'
metadata JSONB NOT NULL DEFAULT '{}'::jsonb
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
deleted_at TIMESTAMPTZ
```

Constraints:

- Organization workflows require `organization_id`.
- Platform workflows require `organization_id IS NULL`.
- Project workflows require `project_id`.
- Unique active slug per org/project/scope.
- `current_version > 0`.

Indexes:

- `(organization_id, status, updated_at DESC) WHERE deleted_at IS NULL`
- `(organization_id, is_enabled, next_run_at) WHERE deleted_at IS NULL AND is_enabled = TRUE`
- `(project_id, status) WHERE deleted_at IS NULL`
- `(workflow_type, status) WHERE deleted_at IS NULL`
- GIN on `tags`
- GIN on `metadata`

## Table: automation_workflow_versions

Purpose:

- Immutable published/draft snapshots.
- Runs reference a specific version.

Columns:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE
version INTEGER NOT NULL
status VARCHAR(30) NOT NULL DEFAULT 'draft'
definition JSONB NOT NULL DEFAULT '{}'::jsonb
trigger_summary JSONB NOT NULL DEFAULT '[]'::jsonb
condition_summary JSONB NOT NULL DEFAULT '[]'::jsonb
action_summary JSONB NOT NULL DEFAULT '[]'::jsonb
published_by UUID NULL REFERENCES users(id) ON DELETE SET NULL
published_at TIMESTAMPTZ
checksum VARCHAR(128) NOT NULL
metadata JSONB NOT NULL DEFAULT '{}'::jsonb
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Constraints:

- Unique `(workflow_id, version)`.
- Definition must be JSON object.
- Summaries must be JSON arrays.
- Published version must have `published_at`.

Indexes:

- `(workflow_id, version DESC)`
- `(workflow_id, status)`
- `(checksum)`

## Table: automation_triggers

Purpose:

- Normalized trigger definitions.
- Supports event, schedule, manual, and webhook triggers.

Columns:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE
workflow_version_id UUID NULL REFERENCES automation_workflow_versions(id) ON DELETE CASCADE
trigger_kind automation_trigger_kind NOT NULL
trigger_type VARCHAR(120) NOT NULL
source_module VARCHAR(80) NOT NULL
source_event VARCHAR(120)
schedule_cron VARCHAR(120)
timezone VARCHAR(80) NOT NULL DEFAULT 'UTC'
webhook_secret_hash VARCHAR(255)
is_enabled BOOLEAN NOT NULL DEFAULT TRUE
dedupe_key_template VARCHAR(500)
cooldown_seconds INTEGER NOT NULL DEFAULT 0
config JSONB NOT NULL DEFAULT '{}'::jsonb
metadata JSONB NOT NULL DEFAULT '{}'::jsonb
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
deleted_at TIMESTAMPTZ
```

Constraints:

- Schedule triggers require `schedule_cron`.
- Event triggers require `source_event`.
- Cooldown cannot be negative.

Indexes:

- `(source_module, source_event, is_enabled) WHERE deleted_at IS NULL`
- `(workflow_id, is_enabled) WHERE deleted_at IS NULL`
- `(trigger_kind, trigger_type) WHERE deleted_at IS NULL`
- GIN on `config`

## Table: automation_conditions

Purpose:

- Ordered condition groups evaluated before actions run.

Columns:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE
workflow_version_id UUID NULL REFERENCES automation_workflow_versions(id) ON DELETE CASCADE
condition_group VARCHAR(80) NOT NULL DEFAULT 'default'
sort_order INTEGER NOT NULL DEFAULT 0
left_path VARCHAR(300) NOT NULL
operator automation_condition_operator NOT NULL
right_value JSONB
value_type VARCHAR(30) NOT NULL DEFAULT 'json'
is_required BOOLEAN NOT NULL DEFAULT TRUE
metadata JSONB NOT NULL DEFAULT '{}'::jsonb
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
deleted_at TIMESTAMPTZ
```

Indexes:

- `(workflow_id, condition_group, sort_order) WHERE deleted_at IS NULL`
- `(workflow_version_id, sort_order) WHERE deleted_at IS NULL`

## Table: automation_actions

Purpose:

- Ordered actions executed by workflow runs.

Columns:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE
workflow_version_id UUID NULL REFERENCES automation_workflow_versions(id) ON DELETE CASCADE
action_key VARCHAR(100) NOT NULL
action_type VARCHAR(120) NOT NULL
integration_key VARCHAR(80)
sort_order INTEGER NOT NULL DEFAULT 0
is_enabled BOOLEAN NOT NULL DEFAULT TRUE
requires_approval BOOLEAN NOT NULL DEFAULT FALSE
risk_level automation_action_risk NOT NULL DEFAULT 'low'
timeout_seconds INTEGER NOT NULL DEFAULT 60
max_attempts INTEGER NOT NULL DEFAULT 3
retry_backoff_seconds INTEGER NOT NULL DEFAULT 30
idempotency_key_template VARCHAR(500)
config JSONB NOT NULL DEFAULT '{}'::jsonb
metadata JSONB NOT NULL DEFAULT '{}'::jsonb
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
deleted_at TIMESTAMPTZ
```

Constraints:

- `timeout_seconds > 0`.
- `max_attempts > 0`.
- High or critical risk actions should require approval through service validation.

Indexes:

- `(workflow_id, sort_order) WHERE deleted_at IS NULL`
- `(workflow_version_id, sort_order) WHERE deleted_at IS NULL`
- `(action_type, is_enabled) WHERE deleted_at IS NULL`
- `(risk_level) WHERE deleted_at IS NULL`

## Table: automation_events_inbox

Purpose:

- Idempotent automation trigger inbox.
- External modules insert trigger events here or call service that inserts here.
- Workers consume inbox rows and create runs.

Columns:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE
project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL
source_module VARCHAR(80) NOT NULL
event_type VARCHAR(120) NOT NULL
source_event_id VARCHAR(200)
dedupe_key VARCHAR(300) NOT NULL
payload JSONB NOT NULL DEFAULT '{}'::jsonb
headers JSONB NOT NULL DEFAULT '{}'::jsonb
status VARCHAR(40) NOT NULL DEFAULT 'pending'
received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
locked_at TIMESTAMPTZ
locked_by VARCHAR(100)
processed_at TIMESTAMPTZ
attempts INTEGER NOT NULL DEFAULT 0
next_retry_at TIMESTAMPTZ
last_error TEXT
metadata JSONB NOT NULL DEFAULT '{}'::jsonb
```

Constraints:

- Unique `(dedupe_key)`.
- Attempts cannot be negative.

Indexes:

- `(status, next_retry_at, received_at)`
- `(organization_id, received_at DESC)`
- `(source_module, event_type, received_at DESC)`
- GIN on `payload`

## Table: automation_runs

Purpose:

- One execution instance for a workflow version.

Columns:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE
project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL
workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE
workflow_version_id UUID NOT NULL REFERENCES automation_workflow_versions(id) ON DELETE RESTRICT
trigger_id UUID NULL REFERENCES automation_triggers(id) ON DELETE SET NULL
inbox_event_id UUID NULL REFERENCES automation_events_inbox(id) ON DELETE SET NULL
status automation_run_status NOT NULL DEFAULT 'queued'
trigger_type VARCHAR(120) NOT NULL
source_module VARCHAR(80) NOT NULL
source_event_id VARCHAR(200)
dedupe_key VARCHAR(300)
idempotency_key VARCHAR(300) NOT NULL
priority INTEGER NOT NULL DEFAULT 0
queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
started_at TIMESTAMPTZ
completed_at TIMESTAMPTZ
cancelled_at TIMESTAMPTZ
expires_at TIMESTAMPTZ
attempt INTEGER NOT NULL DEFAULT 1
max_attempts INTEGER NOT NULL DEFAULT 1
input_payload JSONB NOT NULL DEFAULT '{}'::jsonb
output_payload JSONB NOT NULL DEFAULT '{}'::jsonb
error_code VARCHAR(120)
error_message TEXT
metadata JSONB NOT NULL DEFAULT '{}'::jsonb
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Constraints:

- Unique `(idempotency_key)`.
- `attempt > 0`.
- `max_attempts > 0`.

Indexes:

- `(organization_id, created_at DESC)`
- `(workflow_id, created_at DESC)`
- `(status, priority DESC, queued_at)`
- `(status, expires_at)`
- `(inbox_event_id)`
- `(dedupe_key)`
- BRIN on `created_at`
- GIN on `input_payload`

Partitioning:

- If existing migration style supports partitioning, partition `automation_runs` by month on `created_at`.
- If not, create BRIN index and leave partitioning for follow-up.

## Table: automation_run_steps

Purpose:

- Step-level execution history.

Columns:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE
workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE
action_id UUID NULL REFERENCES automation_actions(id) ON DELETE SET NULL
step_key VARCHAR(100) NOT NULL
action_type VARCHAR(120) NOT NULL
status automation_step_status NOT NULL DEFAULT 'queued'
sort_order INTEGER NOT NULL DEFAULT 0
attempt INTEGER NOT NULL DEFAULT 1
max_attempts INTEGER NOT NULL DEFAULT 1
started_at TIMESTAMPTZ
completed_at TIMESTAMPTZ
next_retry_at TIMESTAMPTZ
timeout_at TIMESTAMPTZ
requires_approval BOOLEAN NOT NULL DEFAULT FALSE
approval_id UUID NULL
idempotency_key VARCHAR(300)
input_payload JSONB NOT NULL DEFAULT '{}'::jsonb
output_payload JSONB NOT NULL DEFAULT '{}'::jsonb
error_code VARCHAR(120)
error_message TEXT
metadata JSONB NOT NULL DEFAULT '{}'::jsonb
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Indexes:

- `(run_id, sort_order)`
- `(workflow_id, created_at DESC)`
- `(status, next_retry_at)`
- `(approval_id)`
- `(idempotency_key)`

## Table: automation_approvals

Purpose:

- Human approval gates for high-risk actions.

Columns:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE
run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE
step_id UUID NULL REFERENCES automation_run_steps(id) ON DELETE SET NULL
requested_by UUID NULL REFERENCES users(id) ON DELETE SET NULL
approved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL
rejected_by UUID NULL REFERENCES users(id) ON DELETE SET NULL
status automation_approval_status NOT NULL DEFAULT 'pending'
risk_level automation_action_risk NOT NULL DEFAULT 'high'
approval_reason TEXT
rejection_reason TEXT
expires_at TIMESTAMPTZ NOT NULL
decided_at TIMESTAMPTZ
request_payload JSONB NOT NULL DEFAULT '{}'::jsonb
decision_payload JSONB NOT NULL DEFAULT '{}'::jsonb
metadata JSONB NOT NULL DEFAULT '{}'::jsonb
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Constraints:

- `expires_at > created_at`.
- Approved rows require `approved_by` and `decided_at`.
- Rejected rows require `rejected_by` and `decided_at`.

Indexes:

- `(organization_id, status, created_at DESC)`
- `(run_id)`
- `(step_id)`
- `(expires_at) WHERE status = 'pending'`

## Table: automation_templates

Purpose:

- Platform or org-level reusable workflow blueprints.
- Default templates are seeded here.

Columns:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
template_key VARCHAR(120) NOT NULL
scope automation_template_scope NOT NULL DEFAULT 'platform'
organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE
name VARCHAR(150) NOT NULL
description TEXT
workflow_type VARCHAR(80) NOT NULL
category VARCHAR(80) NOT NULL
is_active BOOLEAN NOT NULL DEFAULT TRUE
is_public BOOLEAN NOT NULL DEFAULT TRUE
is_featured BOOLEAN NOT NULL DEFAULT FALSE
minimum_plan_tier billing_plan_tier NULL
required_feature_key VARCHAR(100)
tags TEXT[] NOT NULL DEFAULT '{}'
sort_order INTEGER NOT NULL DEFAULT 0
metadata JSONB NOT NULL DEFAULT '{}'::jsonb
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
deleted_at TIMESTAMPTZ
```

Constraints:

- Unique `(scope, organization_id, template_key)` with null-safe strategy if possible.

Indexes:

- `(scope, category, sort_order) WHERE deleted_at IS NULL`
- `(organization_id, category) WHERE deleted_at IS NULL`
- `(required_feature_key) WHERE deleted_at IS NULL`
- GIN on `tags`
- GIN on `metadata`

## Table: automation_template_versions

Purpose:

- Immutable template definitions.

Columns:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
template_id UUID NOT NULL REFERENCES automation_templates(id) ON DELETE CASCADE
version INTEGER NOT NULL
is_current BOOLEAN NOT NULL DEFAULT FALSE
definition JSONB NOT NULL
trigger_summary JSONB NOT NULL DEFAULT '[]'::jsonb
condition_summary JSONB NOT NULL DEFAULT '[]'::jsonb
action_summary JSONB NOT NULL DEFAULT '[]'::jsonb
created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL
published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
checksum VARCHAR(128) NOT NULL
metadata JSONB NOT NULL DEFAULT '{}'::jsonb
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Constraints:

- Unique `(template_id, version)`.
- One current version per template.

Indexes:

- `(template_id, version DESC)`
- `(template_id) WHERE is_current = TRUE`
- `(checksum)`

## Table: automation_audit_logs

Purpose:

- Immutable automation audit trail.

Columns:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE
project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL
workflow_id UUID NULL REFERENCES automation_workflows(id) ON DELETE SET NULL
run_id UUID NULL REFERENCES automation_runs(id) ON DELETE SET NULL
step_id UUID NULL REFERENCES automation_run_steps(id) ON DELETE SET NULL
approval_id UUID NULL REFERENCES automation_approvals(id) ON DELETE SET NULL
actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL
actor_type VARCHAR(40) NOT NULL DEFAULT 'user'
action VARCHAR(120) NOT NULL
entity_type VARCHAR(80) NOT NULL
entity_id UUID
request_id VARCHAR(100)
ip_address INET
user_agent TEXT
before_state JSONB
after_state JSONB
metadata JSONB NOT NULL DEFAULT '{}'::jsonb
occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Indexes:

- `(organization_id, occurred_at DESC)`
- `(workflow_id, occurred_at DESC)`
- `(run_id, occurred_at DESC)`
- `(action, occurred_at DESC)`
- `(actor_user_id, occurred_at DESC)`
- BRIN on `occurred_at`
- GIN on `metadata`

Do not allow updates to audit logs except through migration fixes.

## Views

Create views for efficient frontend and internal reads:

```sql
v_automation_workflow_summaries
v_automation_run_summaries
v_automation_pending_approvals
```

`v_automation_workflow_summaries` should include:

- workflow id
- organization id
- name
- slug
- workflow type
- status
- enabled state
- current version
- trigger count
- action count
- last run status
- last run time
- next run time
- created/updated timestamps

`v_automation_run_summaries` should include:

- run id
- workflow id
- workflow name
- status
- trigger type
- source module
- step count
- failed step count
- pending approval count
- created/started/completed timestamps

`v_automation_pending_approvals` should include:

- approval id
- org id
- workflow id
- run id
- step id
- risk level
- status
- expires at
- workflow name
- action type

## Default Template Seed

Create `015_automation_default_templates_seed.sql`.

Seed platform-level templates only.

Do not seed active workflows.

All templates should be idempotent.

Seed at least these templates:

1. `alert-route-by-service-severity`
2. `escalate-unresolved-critical-alert`
3. `create-incident-for-critical-alert`
4. `append-incident-timeline-from-alert`
5. `generate-postmortem-draft`
6. `release-health-guard`
7. `rollback-recommendation-with-approval`
8. `deduplicate-noisy-alerts`
9. `silence-known-maintenance-window`
10. `open-runbook-for-critical-service`
11. `retry-connector-dead-letter`
12. `retry-ingestion-dead-letter`
13. `notify-quota-threshold`
14. `ai-credit-usage-spike`
15. `security-api-key-anomaly`
16. `daily-service-health-report`
17. `weekly-release-quality-report`
18. `slo-burn-rate-incident`
19. `cron-missed-job-escalation`
20. `uptime-failure-status-page-draft`

Each template needs:

- `template_key`
- `name`
- `description`
- `workflow_type`
- `category`
- `minimum_plan_tier`
- `required_feature_key`
- tags
- metadata
- current template version
- definition JSON
- trigger summary
- condition summary
- action summary

Use `required_feature_key` from the billing seed where possible:

```text
module_alerting_enabled
module_alerting_features_multi_channel
module_alerting_features_escalation_policies
module_alerting_features_deduplication
module_alerting_features_silencing
module_incident_management_enabled
module_incident_management_features_timelines
module_incident_management_features_postmortems
module_version_management_enabled
module_version_management_features_release_gates
module_ai_insights_enabled
module_ai_insights_features_incident_summary
module_connectors_enabled
module_billing_ops_cost_alerts
module_cron_monitoring_enabled
module_uptime_monitoring_enabled
```

## Template Definition JSON Shape

Use a stable JSON shape:

```json
{
  "schemaVersion": 1,
  "workflowType": "incident_creation",
  "trigger": {
    "kind": "event",
    "type": "alert.event.created",
    "sourceModule": "alerting"
  },
  "conditions": [
    {
      "leftPath": "$.severity",
      "operator": "in",
      "rightValue": ["critical", "fatal"]
    }
  ],
  "actions": [
    {
      "actionKey": "create_incident",
      "actionType": "incident.create",
      "riskLevel": "medium",
      "requiresApproval": false,
      "config": {}
    }
  ],
  "safety": {
    "maxRunsPerHour": 100,
    "dedupeWindowSeconds": 300,
    "requiresApprovalAboveRisk": "high"
  }
}
```

Use JSONB validation constraints only where safe. Avoid overly strict SQL constraints that make future template evolution painful.

## Backend Module Structure

Create a new module:

```text
src/modules/automation
```

Suggested structure:

```text
src/modules/automation/automation.module.ts
src/modules/automation/routes.ts
src/modules/automation/controller.ts
src/modules/automation/service.ts
src/modules/automation/repository.ts
src/modules/automation/types.ts
src/modules/automation/schemas.ts
src/modules/automation/errors.ts
src/modules/automation/evaluator.ts
src/modules/automation/action-runner.ts
src/modules/automation/template.service.ts
src/modules/automation/audit.ts
src/modules/automation/workers.ts
```

Follow existing module patterns from billing, alerting, connectors, and event-analytics.

Register routes under:

```text
/organizations/:orgId/automation
```

Register super-admin template/system routes separately if the app has a super-admin route convention. If none exists, keep platform template writes service-internal for now and expose read-only template listing to org users.

## Public Org APIs

Implement:

```text
GET    /organizations/:orgId/automation/workflows
POST   /organizations/:orgId/automation/workflows
GET    /organizations/:orgId/automation/workflows/:workflowId
PATCH  /organizations/:orgId/automation/workflows/:workflowId
DELETE /organizations/:orgId/automation/workflows/:workflowId
POST   /organizations/:orgId/automation/workflows/:workflowId/enable
POST   /organizations/:orgId/automation/workflows/:workflowId/disable
POST   /organizations/:orgId/automation/workflows/:workflowId/publish
POST   /organizations/:orgId/automation/workflows/:workflowId/test
POST   /organizations/:orgId/automation/workflows/:workflowId/run
GET    /organizations/:orgId/automation/workflows/:workflowId/runs
```

Runs:

```text
GET    /organizations/:orgId/automation/runs
GET    /organizations/:orgId/automation/runs/:runId
POST   /organizations/:orgId/automation/runs/:runId/cancel
POST   /organizations/:orgId/automation/runs/:runId/retry
GET    /organizations/:orgId/automation/runs/:runId/steps
```

Approvals:

```text
GET    /organizations/:orgId/automation/approvals
GET    /organizations/:orgId/automation/approvals/:approvalId
POST   /organizations/:orgId/automation/approvals/:approvalId/approve
POST   /organizations/:orgId/automation/approvals/:approvalId/reject
```

Templates:

```text
GET    /organizations/:orgId/automation/templates
GET    /organizations/:orgId/automation/templates/:templateKey
POST   /organizations/:orgId/automation/templates/:templateKey/create-workflow
```

Audit:

```text
GET    /organizations/:orgId/automation/audit
```

Inbox/event endpoint for internal or authenticated module use:

```text
POST   /organizations/:orgId/automation/events
```

This endpoint should be protected and rate limited. It should require org access and validate `sourceModule`, `eventType`, `dedupeKey`, and payload size.

## Authorization

Use existing auth middleware:

- `authenticate`
- `requireOrgAccess`

Add role/permission checks if the codebase has owner/admin role middleware. If not, implement conservative service checks using organization membership role.

Suggested permissions:

- View workflows: org member.
- Create/update/delete workflows: org admin/owner.
- Enable/disable workflows: org admin/owner.
- Approve high-risk actions: org owner/admin.
- View runs: org member.
- Cancel/retry runs: org admin/owner.
- View audit: org admin/owner.
- Create from template: org admin/owner.

Super admin:

- Manage platform templates.
- Manage action registry/safety policy if implemented.

## Billing Entitlement Checks

Before enabling or running a workflow, check billing entitlements:

- `module_automation_enabled`
- `limit_workflows_max`
- Feature-specific keys based on template/action:
  - alerting features for alerting actions
  - incident management features for incident actions
  - AI features for AI summary/root cause
  - connector features for connector actions
  - billing ops for quota/cost actions

Use existing billing entitlements repository/service patterns. If no direct service dependency pattern exists, add a small repository query to check effective entitlement by org id and feature key.

Do not block reading existing workflows if entitlement is lost. Disable execution and show required feature in response metadata.

## Workflow Creation Rules

Workflow creation input should include:

- name
- description
- workflow type
- scope
- project id optional
- trigger definition
- conditions
- actions
- tags
- metadata

Validate:

- name length.
- slug uniqueness.
- allowed trigger types.
- allowed action types.
- payload size.
- max conditions.
- max actions.
- no critical action without approval.
- org has entitlement.
- org has not exceeded `limit_workflows_max`.

Generate slug server-side if absent.

Store workflow as draft.

Create workflow version 1 as draft.

Create normalized triggers/conditions/actions rows.

## Publish Rules

Publishing a workflow should:

- Validate full definition.
- Generate checksum.
- Create immutable workflow version.
- Mark version as published/current.
- Update `automation_workflows.current_version`.
- Set status to active if requested.
- Write audit log.

Do not mutate published version records after publish.

## Run Creation Rules

Run creation should:

- Resolve active workflow version.
- Evaluate trigger matching.
- Evaluate conditions.
- Enforce dedupe/cooldown.
- Create run row with idempotency key.
- Create run step rows for enabled actions.
- Queue worker job or run synchronously for manual test only.
- Write audit log.

Idempotency:

- A repeated trigger with same dedupe key inside the same workflow should not create duplicate runs.
- Use unique `automation_runs.idempotency_key`.
- Use `automation_events_inbox.dedupe_key`.

Dedupe key format:

```text
automation:{orgId}:{workflowId}:{triggerType}:{sourceEventId-or-hash}
```

## Worker Requirements

Use existing worker/queue style.

Worker responsibilities:

- Claim pending inbox events.
- Match workflows.
- Create runs.
- Execute queued run steps.
- Handle retries.
- Mark failed/timeout.
- Create approvals.
- Resume approved runs.
- Expire stale approvals.
- Emit audit logs.

Worker must use safe database locking:

```sql
FOR UPDATE SKIP LOCKED
```

Do not load all pending rows into memory.

Batch processing must be bounded.

Use indexes on status/next_retry_at/queued_at.

## Action Runner

Implement an action runner abstraction:

```ts
type AutomationActionHandler = {
  actionType: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  execute(ctx: AutomationActionContext): Promise<AutomationActionResult>;
};
```

Register handlers for safe initial actions:

- `notification.send`
- `approval.request`
- `connector.delivery.retry`
- `alert.silence.create`
- `ai.summary.generate`
- `ai.root_cause.generate`
- `report.export`
- `rollback.recommend`
- `quota.notify`
- `security.notify`
- `noop`

For actions whose full target API does not exist yet, implement a safe stub that records an output payload explaining `not_implemented` and marks the step skipped or succeeded based on template config.

Do not fake destructive behavior.

## Edge Cases

Handle all of these:

- Org deleted while workflow run is queued.
- Project deleted while workflow run is queued.
- Workflow disabled while run is executing.
- Published version changed while old run is executing.
- User who created workflow is deleted.
- Approval actor is removed from org before approval.
- Entitlement removed after workflow creation.
- Entitlement removed during run.
- Connector deleted before action executes.
- Alert event already resolved before action executes.
- Duplicate trigger event arrives concurrently.
- Worker crashes after creating run but before steps.
- Worker crashes after executing external action but before DB update.
- Step times out.
- Approval expires.
- Run cancellation during approval wait.
- JSON payload too large.
- Invalid JSON path in condition.
- Condition references missing payload field.
- Dangerous action missing approval.
- Schedule trigger with invalid cron.
- Timezone invalid.
- Webhook trigger replay attack.
- Rate-limited connector.
- Dead-letter retry exceeds retry budget.
- AI credits insufficient.
- Billing plan downgrade disables automation.

## Safety Policy

Default policy:

- Low risk actions can run automatically.
- Medium risk actions can run automatically if configured.
- High risk actions require approval.
- Critical risk actions require approval and owner/admin role.

Never execute these automatically in Phase 2:

- Production rollback.
- Data purge.
- Permanent API key revoke.
- Disable ingestion.
- Delete connector.
- Delete project.
- Delete organization.

Only recommend or request approval.

## Condition Evaluation

Implement JSON-path-like payload reads.

Keep it simple:

- Support dot paths like `severity`, `service`, `environment`, `labels.team`.
- Optionally support `$.severity` by normalizing away `$.`.
- Do not implement a full arbitrary expression engine in SQL.
- Evaluate in TypeScript for safety and testability.

Operators:

- eq
- neq
- gt
- gte
- lt
- lte
- in
- not_in
- contains
- not_contains
- matches
- exists
- not_exists
- between

Regex must be bounded and safe. Reject very long regex patterns.

## Schedule Triggers

Support schedule definitions in schema.

If cron parser dependency already exists, use it. Otherwise, store cron and implement execution later.

Do not add a new heavy scheduler dependency without checking existing workers.

Schedule worker should:

- Find enabled schedule triggers.
- Compute next run.
- Enqueue run.
- Update next run.

This can be implemented after event/manual run support if needed.

## API Response Shape

Follow existing response conventions:

```json
{
  "success": true,
  "data": {}
}
```

For list endpoints:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "total": 0,
    "limit": 50,
    "offset": 0
  }
}
```

Error shape should follow existing `AppError` conventions.

## Zod Schemas

Create schemas for:

- create workflow
- update workflow
- publish workflow
- manual run
- test workflow
- list workflows query
- list runs query
- cancel run
- retry run
- approve approval
- reject approval
- create from template
- ingest automation event
- list audit query

Validate:

- UUIDs.
- string lengths.
- enum values.
- JSON object shapes.
- max array sizes.
- max actions per workflow.
- max conditions per workflow.

Suggested limits:

- max workflow name length: 150
- max description length: 2000
- max tags: 20
- max tag length: 50
- max conditions: 50
- max actions: 25
- max payload size: 256 KB for public org event endpoint
- max metadata size: 32 KB

## Repository Requirements

Use parameterized SQL only.

No string-concatenated SQL with user input.

Repository should provide:

- list workflows
- get workflow
- create workflow transaction
- update workflow
- soft delete workflow
- enable/disable workflow
- publish workflow transaction
- create workflow version
- list templates
- get template
- create workflow from template transaction
- insert inbox event
- claim inbox events
- find matching workflows
- create run transaction
- list runs
- get run
- list run steps
- update run status
- claim run steps
- update step status
- create approval
- approve/reject approval transaction
- list approvals
- write audit log

Transactions:

- Use transaction for workflow creation.
- Use transaction for publishing.
- Use transaction for creating run + steps.
- Use transaction for approval decision + step/run state changes.

## Service Requirements

Service must enforce:

- authorization boundaries.
- entitlement checks.
- workflow count limits.
- risk policy.
- action validation.
- trigger validation.
- condition validation.
- idempotency.
- audit writes.

Do not put business logic only in controller.

## Integration With Existing Modules

Alerting:

- Automation may be triggered by alert events.
- Automation may create silences through alerting service/repository.
- Automation may change severity only if supported; otherwise record planned action as not implemented.
- Automation may use alert event data for incident proxy until first-class incident schema exists.

Connectors:

- Automation may call connector delivery retry.
- Automation may send notification through existing connector dispatcher if safe.
- Automation may open tickets only if connector type/action supports it.

Billing:

- Automation must check entitlements.
- Quota automation should use existing billing usage/entitlement data.
- Do not mutate billing records except through existing billing APIs/services.

AI:

- Automation may request AI summaries/root-cause.
- Must check AI credits and AI feature entitlements.
- If insufficient credits, step should fail with clear code.

Event analytics:

- Automation may query analytics for reports.
- Do not run expensive unbounded queries.

Projects:

- Automation project scope should verify project belongs to org.

Organization:

- Every org-scoped query must filter by `organization_id`.

## Audit Requirements

Write audit events for:

- workflow creation
- workflow update
- workflow publish
- enable/disable
- delete/archive
- manual run
- run start
- run success
- run failure
- step success
- step failure
- approval requested
- approval approved
- approval rejected
- template workflow creation

Audit must include:

- actor user id where available
- actor type
- request id
- IP
- user agent
- org id
- workflow id
- run id
- before/after state where useful

## Default Template Details

For each default template, define triggers, conditions, actions, required entitlements, and safety metadata.

### alert-route-by-service-severity

Workflow type:

```text
alert_routing
```

Trigger:

```text
alert.event.created
```

Conditions:

- service exists
- severity in warning/error/critical/fatal

Actions:

- notification.send

Required feature:

```text
module_alerting_features_multi_channel
```

### escalate-unresolved-critical-alert

Trigger:

```text
alert.event.created
```

Conditions:

- severity in critical/fatal
- status not resolved after configured minutes

Actions:

- pagerduty.trigger
- notification.send

Required feature:

```text
module_alerting_features_escalation_policies
```

### create-incident-for-critical-alert

Trigger:

```text
alert.event.created
```

Conditions:

- severity in critical/fatal

Actions:

- incident.create
- notification.send

Required feature:

```text
module_incident_management_enabled
```

### append-incident-timeline-from-alert

Trigger:

```text
alert.event.created
```

Conditions:

- incident id exists or related alert group exists

Actions:

- incident.timeline.append

Required feature:

```text
module_incident_management_features_timelines
```

### generate-postmortem-draft

Trigger:

```text
alert.event.resolved
```

Conditions:

- severity in critical/fatal
- duration greater than configured minutes

Actions:

- ai.summary.generate
- incident.postmortem.generate_draft

Required feature:

```text
module_incident_management_features_postmortems
```

### release-health-guard

Trigger:

```text
release.health_degraded
```

Conditions:

- error rate increased
- latency increased
- crash rate increased

Actions:

- release.guard.warn
- notification.send
- incident.create optionally

Required feature:

```text
module_version_management_features_release_gates
```

### rollback-recommendation-with-approval

Trigger:

```text
release.health_degraded
```

Conditions:

- degradation severe
- confidence above threshold

Actions:

- rollback.recommend
- approval.request

Required feature:

```text
module_version_management_features_release_gates
```

Risk:

```text
high
```

### deduplicate-noisy-alerts

Trigger:

```text
alert.event.created
```

Conditions:

- same fingerprint count greater than threshold

Actions:

- alert.silence.create
- notification.send

Required feature:

```text
module_alerting_features_deduplication
```

### silence-known-maintenance-window

Trigger:

```text
schedule.cron
```

Conditions:

- maintenance window active

Actions:

- alert.silence.create

Required feature:

```text
module_alerting_features_silencing
```

### open-runbook-for-critical-service

Trigger:

```text
alert.event.created
```

Conditions:

- severity critical
- service has runbook url

Actions:

- runbook.open
- notification.send

Required feature:

```text
module_incident_management_enabled
```

### retry-connector-dead-letter

Trigger:

```text
connector.delivery.dead_lettered
```

Conditions:

- attempts less than max retry budget

Actions:

- connector.delivery.retry
- notification.send on final failure

Required feature:

```text
module_connectors_enabled
```

### retry-ingestion-dead-letter

Trigger:

```text
ingestion.dead_letter.created
```

Conditions:

- retryable true
- attempts less than max retry budget

Actions:

- notification.send
- noop until ingestion retry action is implemented

Required feature:

```text
module_automation_enabled
```

### notify-quota-threshold

Trigger:

```text
billing.usage.threshold_breached
```

Conditions:

- usage percent in 80, 90, 100

Actions:

- quota.notify
- notification.send

Required feature:

```text
module_billing_ops_cost_alerts
```

### ai-credit-usage-spike

Trigger:

```text
billing.usage.threshold_breached
```

Conditions:

- meter equals ai_credits

Actions:

- notification.send
- quota.notify

Required feature:

```text
module_ai_insights_enabled
```

### security-api-key-anomaly

Trigger:

```text
security.api_key.suspicious_usage
```

Conditions:

- confidence greater than threshold

Actions:

- security.notify
- notification.send

Required feature:

```text
module_enterprise_features_audit_logs
```

### daily-service-health-report

Trigger:

```text
schedule.cron
```

Conditions:

- none by default

Actions:

- report.export
- notification.send

Required feature:

```text
module_analytics_features_custom_reports
```

### weekly-release-quality-report

Trigger:

```text
schedule.cron
```

Conditions:

- release data exists

Actions:

- ai.summary.generate
- report.export
- notification.send

Required feature:

```text
module_ai_insights_features_weekly_report
```

### slo-burn-rate-incident

Trigger:

```text
slo.burn_rate_breached
```

Conditions:

- burn rate above configured threshold

Actions:

- incident.create
- notification.send

Required feature:

```text
module_incident_management_enabled
```

### cron-missed-job-escalation

Trigger:

```text
cron.missed
```

Conditions:

- job criticality high

Actions:

- incident.create
- notification.send
- pagerduty.trigger

Required feature:

```text
module_cron_monitoring_enabled
```

### uptime-failure-status-page-draft

Trigger:

```text
uptime.failed
```

Conditions:

- public service true
- failure duration greater than threshold

Actions:

- status_page.update as draft only
- approval.request

Required feature:

```text
module_uptime_monitoring_enabled
```

Risk:

```text
high
```

## Tests Required

Add focused tests:

```text
test/unit/automation-service.test.ts
test/unit/automation-repository.test.ts
test/unit/automation-evaluator.test.ts
test/unit/automation-action-runner.test.ts
test/unit/automation-templates.test.ts
test/scripts/canonical-migrations-draft.unit.test.ts updates if needed
```

Test cases:

- workflow create validates payload.
- workflow create enforces org workflow limit.
- high-risk action requires approval.
- workflow publish creates immutable version.
- duplicate inbox event is idempotent.
- duplicate run idempotency key is ignored.
- conditions evaluate correctly.
- missing path condition behaves correctly.
- schedule trigger requires cron.
- manual run creates run and steps.
- disabled workflow does not run.
- lost entitlement blocks run.
- approval approve resumes step.
- approval reject fails/skips step.
- expired approval marks step failed.
- action retry increments attempts.
- action timeout marks failed.
- default templates seed shape is valid.
- template create workflow produces draft workflow.
- audit logs are written.

Integration test:

- If container runtime is available, apply canonical migrations draft and verify automation tables and default templates exist.

## Performance Requirements

Enterprise scale assumptions:

- Many organizations.
- Many workflows per org.
- Many trigger events.
- High write volume during incidents.
- Workers may run concurrently.

Design rules:

- Every org-scoped list query must filter by `organization_id`.
- Use pagination everywhere.
- Do not query JSONB without GIN where possible.
- Do not scan all workflows for every event; filter by `source_module`, `source_event`, `is_enabled`.
- Use dedupe and cooldown to prevent alert storms.
- Use `FOR UPDATE SKIP LOCKED` for workers.
- Use bounded batches.
- Use BRIN indexes for append-heavy history tables.
- Avoid N+1 queries when listing workflows and runs. Use summary views or aggregate joins.

## Security Requirements

- Never expose webhook secrets.
- Store webhook secret hashes only.
- Validate external webhook URLs if implemented.
- Do not execute arbitrary code.
- Do not allow user-provided SQL.
- Do not allow arbitrary shell/runbook execution.
- Sanitize template variables.
- Bound regex and payload size.
- Audit all high-risk actions.
- Require approval for high-risk/critical actions.
- Respect org isolation in every repository query.

## Error Codes

Create domain errors:

```text
AUTOMATION_NOT_FOUND
AUTOMATION_VALIDATION_ERROR
AUTOMATION_CONFLICT
AUTOMATION_ENTITLEMENT_REQUIRED
AUTOMATION_LIMIT_EXCEEDED
AUTOMATION_DISABLED
AUTOMATION_APPROVAL_REQUIRED
AUTOMATION_APPROVAL_EXPIRED
AUTOMATION_RUN_NOT_RETRYABLE
AUTOMATION_ACTION_NOT_SUPPORTED
AUTOMATION_TRIGGER_NOT_SUPPORTED
AUTOMATION_IDEMPOTENCY_CONFLICT
AUTOMATION_PAYLOAD_TOO_LARGE
```

Map errors consistently to HTTP:

- 400 validation
- 401 unauthenticated
- 403 entitlement/permission
- 404 not found
- 409 conflict/idempotency
- 422 invalid workflow definition
- 429 rate limited if implemented
- 500 unexpected

## Frontend Contract

Backend response should allow frontend pages:

```text
/automation/workflows
/automation/workflows/new
/automation/workflows/:workflowId
/automation/runs
/automation/approvals
/automation/templates
/automation/audit
```

Workflow list item should include:

- id
- name
- slug
- workflowType
- status
- isEnabled
- currentVersion
- triggerCount
- actionCount
- lastRunAt
- lastRunStatus
- nextRunAt
- tags
- requiredFeatureKeys

Template list item should include:

- templateKey
- name
- description
- workflowType
- category
- minimumPlanTier
- requiredFeatureKey
- isAvailableForOrg
- unavailableReason
- tags

Approval list item should include:

- approval id
- workflow name
- action type
- risk level
- status
- expiresAt
- run id
- step id

## Documentation Required

Add docs:

```text
docs/automation-phase-2-architecture.md
docs/automation-phase-2-api.md
docs/automation-default-templates.md
```

Docs must explain:

- Alert rules versus automation workflows.
- Ownership model.
- Schema overview.
- API overview.
- Template catalog.
- Safety policy.
- Edge cases.
- Rollout plan.

## Rollout Plan

Implement in this order:

1. Migrations and seed templates.
2. Types and schemas.
3. Repository.
4. Service.
5. Controller and routes.
6. Template create-workflow flow.
7. Condition evaluator.
8. Manual run creation.
9. Action runner with safe actions and stubs.
10. Approval flow.
11. Worker claim/execute loop.
12. Billing entitlement checks.
13. Audit logs.
14. Tests.
15. Documentation.

Do not wire dangerous production actions until approval and audit are proven.

## Acceptance Criteria

The implementation is complete when:

- New `19_automation` canonical migrations exist.
- Default automation templates are seeded idempotently.
- Backend module is registered.
- Org APIs exist and are authenticated.
- Workflows can be created, published, enabled, disabled, manually run, and listed.
- Templates can create draft workflows.
- Runs and steps are recorded.
- High-risk actions create approvals.
- Approvals can be approved/rejected.
- Duplicate trigger events are idempotent.
- Existing alert rules remain separate and unchanged.
- Entitlement checks use the billing feature keys from the enterprise billing seed.
- Tests pass.
- TypeScript build passes.
- Documentation is added.

## Final Verification Commands

Run:

```bash
npm test -- test/scripts/canonical-migrations-draft.unit.test.ts
npm test -- test/unit/automation-service.test.ts test/unit/automation-evaluator.test.ts test/unit/automation-action-runner.test.ts test/unit/automation-templates.test.ts
npm run build
```

If container runtime is available:

```bash
npm run test:integration -- test/integration/canonical-migrations-draft.test.ts
```

Report clearly if integration bootstrap is skipped because container runtime is unavailable.

