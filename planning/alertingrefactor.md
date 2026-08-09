MASTER PROMPT — ENTERPRISE-GRADE ALERTING ARCHITECTURE CONSOLIDATION

You are modifying the backend of our observability SaaS.

Your task is to refactor and consolidate the existing alerting system into ONE canonical, production-grade alerting architecture.

IMPORTANT:

This is NOT a greenfield implementation.

The repository already contains alert rules, rule bindings, evaluators, project thresholds, notification routing, project channels, connector subscriptions, connector workers, queues, delivery tracking, escalation, silencing, deduplication, cooldowns, and multiple legacy/parallel implementations.

You MUST inspect the actual repository before modifying anything.

The goal is to preserve working functionality while eliminating conflicting alerting implementations.

============================================================
1. TARGET ARCHITECTURE
============================================================

The final architecture MUST be:

ORGANIZATION
    ↓
Organization Alert Rule Catalog
    ↓
Project Alert Rule Binding
    ↓
Effective Project Alert Rule
    ↓
Project-scoped Evaluation
    ↓
Alert / Incident
    ↓
Notification Routing
    ↓
Project Channels / Member Preferences
    ↓
Project Connector Subscription
    ↓
Notification Queue
    ↓
Connector Worker
    ↓
Provider
    ↓
Delivery Tracking

The most important invariant:

THE EVALUATOR MUST ONLY EVALUATE EFFECTIVE PROJECT RULES.

The evaluator must NEVER directly evaluate an organization rule as an organization-wide runtime alert.

Organization rules define defaults/capabilities.

Project bindings determine whether and how the project uses those rules.

============================================================
2. DO NOT REBUILD EXISTING FUNCTIONALITY
============================================================

Before changing code, inspect:

- canonical migrations
- all alerting migrations
- alerting module
- project module
- organization module
- notification module
- connector module
- worker module
- queue definitions
- repositories
- services
- controllers
- routes
- evaluators
- runtime engines
- delivery workers
- tests

Find all active and legacy implementations.

Do not assume a table or service is canonical because its name looks correct.

Trace actual reads/writes and runtime call paths.

Produce an implementation plan before making destructive changes.

============================================================
3. CANONICAL RULE OWNERSHIP
============================================================

Use:

alert_rules

as the organization-owned canonical rule catalog.

An organization owns:

- rule identity
- rule key
- name
- description
- signal/metric
- operator
- condition definition
- default threshold
- default evaluation interval
- default lookback window
- default severity
- default cooldown
- default auto-resolve behavior
- execution tier
- default notification behavior where applicable

These defaults belong to the organization rule.

A project override MUST NEVER mutate the organization rule.

============================================================
4. PROJECT SUBSCRIPTION + OVERRIDE
============================================================

Use the existing canonical:

alert_rule_bindings

as the project-level relationship.

Do NOT create another project alert subscription system if alert_rule_bindings already provides the required behavior.

The semantic model is:

Organization Rule
    ↓
Project Binding
    ↓
inherit / override / disable
    ↓
Effective Project Rule

A project can:

1. inherit an organization rule
2. override allowed configuration
3. disable/not subscribe to the rule

The organization rule itself MUST remain unchanged.

Example:

Organization:

high_error_rate
threshold = 5%

Project A:

override threshold = 2%

Result:

Organization = 5%
Project A = 2%
Project B = 5%

Never:

Organization = 2%

============================================================
5. OVERRIDE SAFETY
============================================================

Projects MUST NOT be allowed to redefine the semantics of the rule.

Project overrides should be limited to explicitly supported configuration.

Potentially overridable:

- threshold
- severity
- cooldown
- evaluation interval
- lookback window
- consecutive breach requirement
- notification configuration
- enabled/disabled state

Only allow fields that are already supported by the current schema and intended architecture.

Projects MUST NOT override:

- rule identity
- rule key
- metric/signal
- expression
- operator
- aggregation semantics
- execution tier
- internal evaluator strategy

Unless the existing architecture explicitly supports such an override.

Do not invent new override capabilities.

Reject invalid override fields at validation/service boundaries.

============================================================
6. EFFECTIVE RULE RESOLUTION
============================================================

Create/use one canonical effective-rule resolver.

Conceptually:

resolveEffectiveRules({
    organizationId,
    projectId,
    environmentId?,
    serviceId?,
    endpointId?
})

The resolver must:

1. Load organization-owned rules.
2. Find the applicable project binding.
3. Apply inheritance.
4. Apply project overrides.
5. Apply supported lower-scope overrides if they are actually implemented.
6. Apply disablement.
7. Return immutable effective rules.

The evaluator consumes ONLY the resolved result.

The evaluator must not perform its own independent inheritance logic.

Do not duplicate rule resolution in multiple workers.

============================================================
7. SCOPE HIERARCHY
============================================================

Preserve the existing supported hierarchy if verified in the repository:

organization
    ↓
project
    ↓
environment
    ↓
service
    ↓
endpoint

Do not automatically add new scope levels.

If lower-scope bindings exist, they must resolve into one final effective rule.

Do not evaluate organization + project + environment independently.

Resolve one effective rule for the target project/context.

============================================================
8. PROJECT IS THE RUNTIME TENANT
============================================================

Every runtime evaluation must be project-scoped.

When telemetry arrives:

telemetry
    ↓
organization_id
    ↓
project_id
    ↓
environment/service/endpoint context
    ↓
effective project rules
    ↓
evaluation

The evaluator must not run:

evaluateOrganizationRules()

and separately:

evaluateProjectRules()

Instead:

evaluateEffectiveProjectRules(projectId, context)

The resulting alert must contain:

- organization_id
- project_id
- rule_id
- effective configuration
- environment/scope where applicable
- severity
- fingerprint
- evaluation metadata

============================================================
9. REMOVE COMPETING EVALUATION SYSTEMS
============================================================

Audit and identify all active evaluation systems.

This includes, where present:

- alert_rules evaluator
- alert_rule_bindings evaluator
- project_alert_thresholds
- ProjectThresholdWorker
- V1 batch evaluation
- V2 runtime engines
- fast-path evaluator
- window evaluator
- operational evaluator
- AI evaluator
- scheduled evaluators

The final architecture MUST have ONE canonical evaluation pipeline.

Use the existing V2/runtime architecture if it is the active and correct implementation.

Migrate equivalent functionality from legacy systems into the canonical pipeline where necessary.

Do NOT simply delete functionality because it looks duplicated.

For every legacy evaluator:

1. identify functionality
2. map equivalent canonical rule
3. migrate data/configuration
4. verify runtime behavior
5. disable old execution path
6. remove code only after verification

============================================================
10. EXECUTION TIERS
============================================================

Preserve the existing execution model where verified:

FAST
- unhandled exception
- fatal exception
- process crash
- OOM
- authentication failure
- security events
- deployment failure
- heartbeat failure
- similar instant signals

WINDOW
- error rate
- latency
- traffic
- inactivity
- error volume
- cron rate
- other rollup-based metrics

OPERATIONAL
- CPU
- memory
- queue backlog
- service health
- endpoint health
- operational metrics

AI
- AI failure rate
- AI latency
- AI credit usage
- AI cost
- AI token usage

Do not confuse:

evaluation_interval

with:

lookback_window

Example:

evaluation_interval = 1 minute
lookback_window = 5 minutes

means:

evaluate every minute using the previous five minutes.

============================================================
11. CONDITION ENGINE
============================================================

Preserve the existing condition engine capabilities where verified:

- gt
- gte
- lt
- lte
- eq
- neq
- contains
- regex
- in
- exists

Preserve the current condition grouping semantics if verified.

Do not introduce arbitrary expression-tree complexity unless required by existing functionality.

Condition evaluation must be deterministic.

============================================================
12. BREACH STATE
============================================================

Preserve and centralize:

- consecutive breach requirements
- cooldown
- deduplication
- fingerprinting
- recovery
- auto-resolution
- alert state
- incident state

These must be handled by one canonical runtime.

Do not duplicate cooldown logic in:

- evaluator
- notification router
- connector worker

Cooldown and deduplication are different concepts.

DEDUPLICATION:

Determines whether two alerts represent the same underlying alert/incident.

COOLDOWN:

Determines how frequently notification can be emitted while an incident remains active.

Do not merge these concepts.

============================================================
13. ALERT VS NOTIFICATION
============================================================

Maintain a strict separation.

ALERT ENGINE:

Determines:

"Did the project's rule breach?"

NOTIFICATION SYSTEM:

Determines:

"Who should be notified and through which destination?"

The evaluator must NOT contain Slack/email/Discord-specific routing logic.

The evaluator creates an alert/incident event.

The notification pipeline consumes that event.

============================================================
14. ALERT EVENT
============================================================

Use the canonical active alert event model.

The alert event must identify:

- organization
- project
- rule
- severity
- environment/scope
- fingerprint
- triggered/recovered state
- timestamps
- evaluation metadata

Do not create multiple independent alert event representations unless existing compatibility requires them.

If alert_events and alert_events_v2 both exist:

1. identify which one is canonical
2. migrate consumers
3. migrate producers
4. verify tests
5. disable the legacy path
6. remove only after safe migration

============================================================
15. NOTIFICATION ROUTING
============================================================

After an alert is triggered:

Alert
    ↓
Notification Router

The router is responsible for:

- determining eligible project channels
- checking project connector subscriptions
- checking severity/category filters
- checking member preferences
- checking quiet hours
- checking silences
- checking escalation policies
- resolving final delivery targets

Do not make the alert evaluator perform these operations.

============================================================
16. PROJECT ALERT CHANNELS
============================================================

Use the existing:

project_alert_channels

if confirmed active.

A project channel represents a destination within the project notification model.

It may reference an organization connector through the existing subscription architecture.

Do not duplicate connector configuration into project channels.

Conceptually:

Organization
    ↓
Connector
    ↓
Project Connector Subscription
    ↓
Project Alert Channel
    ↓
Routing Target

============================================================
17. CONNECTOR OWNERSHIP
============================================================

Preserve the organization-owned connector model if verified.

Organization owns:

connector configuration/credentials

Project controls:

whether it can use the connector

Project connector subscriptions MUST remain separate from alert-rule subscriptions.

These are different concepts.

ALERT RULE SUBSCRIPTION:

"Does this project use this alert rule?"

CONNECTOR SUBSCRIPTION:

"Can this project use this organization connector?"

Never merge these concepts.

============================================================
18. MEMBER RECIPIENT RESOLUTION
============================================================

Use existing project member notification preferences where active.

Determine recipients based on:

- project membership
- channel preferences
- alert category
- severity threshold
- enabled/disabled state
- quiet hours
- digest configuration
- escalation

Remove inactive/non-project members from recipient lists.

Prevent cross-project member resolution.

============================================================
19. NO CHANNEL FALLBACK
============================================================

Implement the following explicit fallback:

If an alert is triggered for a project and there are NO eligible configured notification channels:

    resolve active project members
        ↓
    resolve verified email addresses
        ↓
    deduplicate email addresses
        ↓
    create email notification targets
        ↓
    enqueue email delivery

This fallback must be explicit and deterministic.

Do not rely on accidental connector-less behavior.

Define behavior for:

- zero project members
- no verified email
- suspended members
- disabled members
- notification opt-out
- duplicate email addresses

Do not silently send to organization members unless the existing security model explicitly requires it.

============================================================
20. ROUTING SYSTEM CONSOLIDATION
============================================================

Audit all existing routing systems:

- alert_routing_rules
- connector_routes
- notification_routes
- rule actions
- project channels
- member preferences

Determine which one is active.

The final system must have one canonical routing decision path.

Do not allow:

alert_routing_rules

AND

connector_routes

AND

notification_routes

to independently send notifications.

If multiple concepts are necessary, define their responsibilities clearly:

RULE ROUTING:
Which project/channel policy applies?

CHANNEL RESOLUTION:
Which concrete destinations are eligible?

CONNECTOR DELIVERY:
How is the message transported?

Do not duplicate business decisions in connector workers.

============================================================
21. NOTIFICATION QUEUE
============================================================

After routing determines a final notification target:

create a notification job.

Conceptually:

{
    alertId,
    organizationId,
    projectId,
    channelId,
    connectorId,
    provider,
    recipient,
    severity,
    idempotencyKey,
    payload
}

The queue must contain enough information to safely deliver the notification without requiring connector workers to perform business-level routing.

Connector workers should be transport-focused.

============================================================
22. PG-BOSS / QUEUES
============================================================

Preserve the existing PostgreSQL/pg-boss queue architecture.

Do not introduce Redis/BullMQ.

Use provider-specific queues if that is the existing architecture.

Examples:

connector-send-slack
connector-send-email
connector-send-discord
connector-send-webhook
...

Do not create a queue for every severity × provider combination.

Use provider queue + priority.

Preserve existing priority semantics if already implemented.

============================================================
23. IDEMPOTENCY
============================================================

Notification delivery must be idempotent.

Create deterministic idempotency keys based on:

alert
+
destination
+
notification event/type

Ensure a worker crash after provider delivery does not create uncontrolled duplicates.

Audit the existing delivery/idempotency implementation before changing it.

Do not assume database uniqueness alone is sufficient.

============================================================
24. RETRY / DLQ
============================================================

Preserve:

- retry
- exponential backoff
- provider rate limiting
- circuit breakers
- dead-letter behavior
- delivery attempt tracking

Separate:

temporary provider failure

from:

permanent configuration failure.

Do not endlessly retry invalid connector configuration.

============================================================
25. ALERT ESCALATION
============================================================

Preserve existing escalation functionality.

Escalation should operate on the alert/incident lifecycle.

Conceptually:

Alert triggered
    ↓
initial notification
    ↓
wait escalation interval
    ↓
if unresolved
    ↓
next escalation target

Do not make connector workers responsible for escalation decisions.

============================================================
26. SILENCE / MUTE
============================================================

Silences must be evaluated before creating notification jobs.

An alert may still exist internally while notification is suppressed.

Do not delete or suppress the alert event itself merely because notification is silenced.

Maintain clear semantics:

ALERT EXISTS
but
NOTIFICATION SUPPRESSED

============================================================
27. SECURITY
============================================================

Every operation must enforce:

authenticated user
    ↓
organization
    ↓
project
    ↓
resource

Verify organization/project ownership for:

- rules
- bindings
- alert events
- channels
- connectors
- connector subscriptions
- recipients
- notification jobs
- delivery records

Never trust IDs supplied by the frontend.

Never allow:

Project A
→ Project B connector

or:

Project A
→ Project B members

or:

Organization A
→ Organization B alerts.

Fail closed.

============================================================
28. TRANSACTIONAL CONSISTENCY
============================================================

Where rule configuration changes:

- rule binding changes
- subscription changes
- channel changes
- routing changes

ensure database writes are transactional where required.

Avoid partially applied configuration.

If cache invalidation is used:

database commit
    ↓
invalidate/update cache

Never:

cache update
    ↓
database failure

Use optimistic locking/versioning where concurrent configuration updates can overwrite each other.

============================================================
29. CACHING
============================================================

If effective alert rules are cached:

cache key must include appropriate tenant/scope:

organizationId
projectId
environmentId
serviceId
endpointId

Invalidate cache when:

- organization rule changes
- project binding changes
- project override changes
- scope binding changes

Do not cache across projects.

Prefer short-lived/config-version-aware caches over complicated invalidation unless existing infrastructure already supports it.

============================================================
30. OBSERVABILITY
============================================================

Instrument the alerting pipeline.

Track:

- evaluation count
- evaluation latency
- rule resolution latency
- triggered alerts
- recovered alerts
- suppressed alerts
- deduplicated alerts
- notification jobs created
- notification jobs skipped
- delivery success
- delivery failure
- retry count
- DLQ count
- connector latency

Include:

organizationId
projectId
ruleId
alertId
notificationId
correlationId

Never log:

- connector secrets
- OAuth tokens
- webhook secrets
- encrypted credentials
- sensitive member information

============================================================
31. PERFORMANCE
============================================================

The evaluator must NOT execute expensive queries for every telemetry event.

For fast-path rules:

- use indexed/project-scoped lookups
- use pre-resolved/cached effective rule configuration where appropriate
- avoid scanning organization rules repeatedly

For window rules:

- use rollups/analytics data
- avoid full observability table scans
- use existing metric aggregation infrastructure

Avoid N+1 queries.

Do not query project members or connectors during rule evaluation.

Notification routing happens after an alert is created.

============================================================
32. SCHEMA MIGRATION
============================================================

Before writing migrations:

Map:

CURRENT TABLE
→ TARGET TABLE
→ KEEP / MIGRATE / DEPRECATE / DELETE

Primary target:

alert_rules
+
alert_rule_bindings

should become the canonical rule configuration path.

If existing tables such as:

alerting_project_policy_subscriptions
alerting_project_policy_overrides
project_alert_thresholds

represent duplicate concepts:

DO NOT immediately delete them.

First:

1. identify their data
2. map records to canonical rules
3. migrate data
4. update runtime consumers
5. verify production-equivalent behavior
6. disable legacy writers
7. disable legacy readers
8. only then remove deprecated schema

Never lose existing alert configurations.

============================================================
33. MIGRATION OF PROJECT THRESHOLDS
============================================================

If:

project_alert_thresholds

contains alert configurations that are equivalent to organization alert rules:

map them to canonical organization rules + project bindings.

Example:

project_alert_thresholds.error_rate
    ↓
organization alert_rules.error_rate
    ↓
project alert_rule_bindings
    ↓
threshold override

Do not create a second evaluator for old thresholds.

If a threshold has no equivalent canonical rule:

document it explicitly and migrate it into a canonical rule only after verifying its semantics.

Do not silently change alert behavior.

============================================================
34. API COMPATIBILITY
============================================================

Audit existing alerting APIs before modifying them.

For every existing endpoint:

- keep
- adapt
- deprecate
- remove

Do not break frontend functionality unnecessarily.

If an endpoint currently exposes legacy project thresholds:

either:

1. make it operate on canonical alert_rule_bindings

or

2. explicitly deprecate it and migrate the frontend.

Do not leave an API that writes configuration which the runtime ignores.

THIS IS A HARD REQUIREMENT.

Any configuration endpoint exposed to the frontend must modify the configuration actually consumed by the evaluator.

============================================================
35. SEEDING DEFAULT ORGANIZATION RULES
============================================================

When a new organization is created:

provision the default organization alert rule catalog.

The exact default rule catalog must come from the existing canonical presets/catalog.

Do not duplicate preset definitions across:

- migration
- service
- frontend
- evaluator

Use one canonical definition source where possible.

Default organization rules are initially:

organization-owned

Projects must explicitly:

- subscribe/inherit
- override
- disable

according to the product behavior.

Do not automatically evaluate every organization rule for every project unless the existing product requirement explicitly says projects are automatically subscribed.

============================================================
36. PROJECT ALERT CONFIGURATION
============================================================

The final project configuration UI/API should conceptually expose:

Available organization rules
    ↓
Project status:
    - subscribed/inherited
    - overridden
    - disabled

If overridden:

show only allowed override fields.

Do not expose organization-only fields as project-editable.

============================================================
37. ALERT READING / QUERYING
============================================================

When the frontend asks for project alerts:

query alerts by:

organization_id
+
project_id

The alert list MUST NOT query organization-level rules as if they were project alerts.

An alert belongs to the project context in which the effective rule was evaluated.

For alert details, resolve:

- alert
- effective rule metadata
- project
- environment
- service
- incident state
- notifications
- delivery status

while respecting tenant isolation.

============================================================
38. TESTING REQUIREMENTS
============================================================

Create/update tests for:

RULE OWNERSHIP

- organization rule creation
- organization rule update
- project cannot mutate organization rule

SUBSCRIPTION

- project inherits rule
- project disables rule
- project overrides rule
- project override remains project-specific

ISOLATION

- Project A cannot affect Project B
- Project A cannot read Project B rule bindings
- Project A cannot use Project B connector
- Project A cannot notify Project B members

EVALUATION

- only effective project rules evaluated
- organization rule is not directly evaluated
- threshold override works
- inherited default works
- disabled rule does not evaluate

BREACH

- consecutive breaches
- cooldown
- deduplication
- recovery
- auto-resolve

ROUTING

- Slack channel
- email channel
- multiple channels
- severity filtering
- member preferences
- quiet hours
- escalation

FALLBACK

- no channel → project member emails
- no active members
- unverified emails
- duplicate emails
- disabled members

DELIVERY

- queue creation
- provider routing
- retry
- idempotency
- DLQ
- connector failure

CONCURRENCY

- duplicate evaluations
- duplicate notification jobs
- concurrent project rule updates
- concurrent delivery attempts

============================================================
39. ACCEPTANCE TEST — CRITICAL SCENARIO
============================================================

Implement and test this exact scenario:

Organization:

high_error_rate
threshold = 5%

Project A:

inherits rule

Project B:

overrides threshold to 2%

Project C:

disabled

Telemetry:

Project A error rate = 3%

Project B error rate = 3%

Project C error rate = 10%

Expected:

Project A:
NO ALERT

Project B:
ALERT

Project C:
NO ALERT

The organization rule remains:

5%

This test proves the core architecture.

============================================================
40. NOTIFICATION ACCEPTANCE TEST
============================================================

For Project B:

Rule triggers.

Project B has:

Slack channel configured.

Expected:

alert created
→ notification job
→ Slack queue
→ Slack worker
→ Slack delivery

If Project B has no configured channel:

Expected:

alert created
→ notification router
→ no eligible configured channel
→ resolve active project members
→ resolve verified emails
→ email jobs
→ email worker
→ delivery

============================================================
41. LEGACY PATH ACCEPTANCE
============================================================

After migration:

No legacy evaluator may independently generate alerts.

No legacy project threshold worker may independently generate duplicate alerts.

No legacy policy subscription API may modify configuration ignored by runtime.

No routing implementation may independently bypass the canonical notification router.

No connector worker may perform business-level routing.

============================================================
42. CODE QUALITY STANDARD
============================================================

Implement using enterprise-grade standards.

Requirements:

- TypeScript strict mode
- explicit domain types
- no `any` unless absolutely unavoidable and justified
- dependency inversion where appropriate
- small cohesive services
- repository/service separation
- schema validation at API boundaries
- typed errors
- structured logging
- correlation IDs
- deterministic behavior
- idempotency
- transaction boundaries
- clear naming
- no hidden side effects
- no circular dependencies
- no duplicated business logic
- no magic constants
- configuration-driven behavior
- exhaustive tests for critical paths

Do not overengineer.

Do not introduce a new framework merely for this refactor.

Follow the existing backend architecture unless there is a concrete reason to change it.

============================================================
43. IMPLEMENTATION ORDER
============================================================

Execute in this order:

PHASE 1
Repository + schema audit.

PHASE 2
Identify canonical V2 alert runtime.

PHASE 3
Make alert_rule_bindings the canonical project configuration source.

PHASE 4
Implement/verify effective rule resolver.

PHASE 5
Move all evaluation to effective project rules.

PHASE 6
Migrate project thresholds/policy subscriptions into canonical bindings.

PHASE 7
Disable legacy evaluators.

PHASE 8
Canonicalize notification routing.

PHASE 9
Implement explicit no-channel → project-member-email fallback.

PHASE 10
Verify connector subscription + project channel flow.

PHASE 11
Harden idempotency/retry/DLQ.

PHASE 12
Update APIs.

PHASE 13
Update tests.

PHASE 14
Remove deprecated code/schema only after all consumers are migrated.

============================================================
44. DO NOT DO
============================================================

DO NOT:

- create a second alert evaluator
- create another subscription table unnecessarily
- create another routing system
- create another notification queue abstraction
- mutate organization rules from project overrides
- evaluate organization rules directly
- allow project rules to change rule semantics
- query all organization rules for every telemetry event
- put Slack/email logic inside evaluators
- put routing logic inside connector workers
- duplicate connector configuration
- introduce Redis/BullMQ
- blindly delete legacy tables
- break existing alert configurations
- leave APIs that modify unused configuration
- trust frontend project IDs without authorization
- use unbounded log/span queries
- introduce unnecessary microservices

============================================================
45. FINAL VERIFICATION
============================================================

After implementation, run a complete audit again.

Verify:

Organization rule
    ↓
Project binding
    ↓
Effective rule
    ↓
Project evaluation
    ↓
Alert
    ↓
Notification router
    ↓
Project channel/member resolution
    ↓
Connector subscription
    ↓
Queue
    ↓
Worker
    ↓
Provider
    ↓
Delivery

There must be ONE canonical path.

Produce a final implementation report:

1. Files changed
2. Migrations added
3. Tables retained
4. Tables deprecated
5. Tables removed
6. APIs changed
7. Evaluators consolidated
8. Routing consolidated
9. Queue changes
10. Connector changes
11. Tests added
12. Legacy paths disabled
13. Backward compatibility
14. Security verification
15. Performance considerations
16. Remaining risks
17. Exact runtime call graph

============================================================
FINAL ARCHITECTURAL INVARIANTS
============================================================

These must be true after implementation:

INVARIANT 1

Organization rules are defaults/catalog definitions.

INVARIANT 2

Project overrides NEVER modify organization rules.

INVARIANT 3

A project alert is evaluated only from its effective project rule.

INVARIANT 4

A disabled project rule is never evaluated.

INVARIANT 5

An inherited project rule uses organization defaults.

INVARIANT 6

A project override changes only that project.

INVARIANT 7

Alert evaluation is independent of notification transport.

INVARIANT 8

Notification routing is independent of rule evaluation.

INVARIANT 9

Connector workers are transport-focused.

INVARIANT 10

Project connector subscriptions control whether a project can use an organization connector.

INVARIANT 11

No configured notification channel results in explicit project-member email fallback.

INVARIANT 12

All alert and notification operations are tenant-isolated.

INVARIANT 13

Every frontend configuration endpoint modifies configuration actually consumed by runtime.

INVARIANT 14

There is only one canonical alert evaluation path.

INVARIANT 15

There is only one canonical notification routing path.

INVARIANT 16

Duplicate alert and duplicate notification generation must be prevented through deterministic idempotency/fingerprinting.

INVARIANT 17

Legacy systems must not remain active in parallel after migration.

============================================================
IMPORTANT FINAL INSTRUCTION
============================================================

Do not start by editing code.

First inspect and map the current implementation.

Then produce:

CURRENT → TARGET

mapping.

Then implement incrementally.

After each major migration:

- run type checking
- run unit tests
- run integration tests
- verify migrations
- verify database constraints
- verify worker startup
- verify queue registration
- verify alert evaluation
- verify notification routing

If the existing code contradicts this specification, do not silently choose one.

Stop and clearly report:

CONFLICT
CURRENT IMPLEMENTATION
TARGET REQUIREMENT
SAFE MIGRATION PATH

Then continue only when the migration path can be implemented without losing alert configurations or producing duplicate alert delivery.

The final system must be production-grade, deterministic, tenant-safe, observable, idempotent, and maintainable.