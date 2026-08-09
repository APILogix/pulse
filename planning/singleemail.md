You are continuing the implementation of the Enterprise Alerting Consolidation Plan already being implemented in this repository.

IMPORTANT:

DO NOT redesign the alerting architecture again.

DO NOT create another notification system.

DO NOT create another routing engine.

DO NOT create another connector abstraction.

The canonical architecture is already established:

Organization Alert Rules
    ↓
Project Alert Rule Bindings
    ↓
Effective Project Rule
    ↓
V2 Project-Scoped Evaluation
    ↓
AlertDecisionEngine
    ↓
Canonical NotificationRoutingService
    ↓
Project Channels / Connector Subscriptions / Member Preferences
    ↓
Notification Jobs
    ↓
Provider Queue
    ↓
Transport Worker
    ↓
Provider

This task adds one critical enterprise capability:

PLAN-AWARE NOTIFICATION ENTITLEMENT ENFORCEMENT.

============================================================
1. BUSINESS REQUIREMENT
============================================================

The organization subscription/plan determines whether connector-based
notification delivery is available.

There are two notification modes.

MODE A — CONNECTOR ENABLED

If the organization's plan permits connector/integration access:

    Alert
        ↓
    Project routing
        ↓
    Project channels
        ↓
    Project connector subscriptions
        ↓
    Member preferences
        ↓
    Eligible recipients
        ↓
    Connector provider
        ↓
    Queue
        ↓
    Delivery

MODE B — CONNECTOR DISABLED

If the organization's plan does NOT permit connector access:

    Alert
        ↓
    EMAIL_ONLY_RESTRICTED_MODE
        ↓
    Project Owner
        ↓
    Managed Platform Email
        ↓
    Project Owner

This is a HARD backend business rule.

============================================================
2. CRITICAL SEMANTICS
============================================================

When connector access is unavailable:

1. Only email delivery is allowed.
2. The project owner is the ONLY recipient.
3. Per-member alert preferences MUST NOT be evaluated.
4. Member-specific notification routing MUST NOT be used.
5. member_ids MUST NOT expand the recipient list.
6. Slack MUST NOT be selected.
7. Discord MUST NOT be selected.
8. Teams MUST NOT be selected.
9. PagerDuty MUST NOT be selected.
10. Webhook MUST NOT be selected.
11. SMS MUST NOT be selected.
12. Customer-managed connector credentials MUST NOT be used.
13. Existing non-email project channels are preserved but become ineligible.
14. Existing connector subscriptions are preserved but cannot produce delivery targets.
15. Escalation MUST NOT bypass the restriction.
16. Retry MUST NOT bypass the restriction.
17. Connector workers MUST NOT convert a blocked notification into a different destination.
18. The notification router, not the connector worker, determines the fallback.
19. The email must use the platform-managed email transport.
20. The project owner is resolved server-side.

This requirement MUST be enforced regardless of frontend behavior.

============================================================
3. DO NOT CONFUSE THESE CONCEPTS
============================================================

Keep the following concepts separate.

ALERT RULE SUBSCRIPTION:

    Does this project evaluate this organization alert rule?

Represented by:

    alert_rule_bindings

CONNECTOR SUBSCRIPTION:

    Is this project authorized to use this organization-owned connector?

Represented by the existing project connector subscription model.

PROJECT ALERT CHANNEL:

    Where should this project's notifications normally go?

Represented by:

    project_alert_channels

MEMBER PREFERENCE:

    Should a particular project member receive notifications from a
    configured project channel?

Represented by existing member preference infrastructure.

PLAN ENTITLEMENT:

    Is this organization allowed to use connector-based notification
    delivery at all?

Represented by the existing billing/entitlement system.

These must NOT be merged.

============================================================
4. FIRST — DISCOVER THE EXISTING ENTITLEMENT SYSTEM
============================================================

Before writing code:

Inspect the existing billing/subscription/entitlement implementation.

Find the canonical source for:

- organization plan
- subscription status
- feature entitlements
- connector/integration access
- plan overrides
- trial state
- subscription state
- feature gates

Search for existing concepts such as:

- entitlement
- feature
- feature_config
- subscription
- plan
- organization_subscription
- integration
- connector
- addon
- feature_override
- billing entitlement

DO NOT invent a new billing table if an existing entitlement service
already exists.

DO NOT read raw plan JSON directly from the alerting module if the
billing system already exposes a canonical entitlement service.

Use the existing domain/service boundary.

============================================================
5. CREATE A CANONICAL NOTIFICATION CAPABILITY CONTRACT
============================================================

Create a small alerting-domain abstraction.

Preferred conceptual location:

    src/modules/alerting/runtime/notification-entitlement.service.ts

or the repository's equivalent existing architecture.

Do NOT make the alerting module directly depend on billing database
tables.

Define a typed capability contract.

Example conceptual model:

    NotificationDeliveryMode

        NORMAL_CONNECTOR
        EMAIL_ONLY_RESTRICTED

The exact naming may follow existing project conventions.

The service should expose something conceptually equivalent to:

    resolveNotificationDeliveryMode({
        organizationId,
        projectId
    })

It must return a deterministic capability decision.

The alerting module should depend on this contract, not on billing
implementation details.

============================================================
6. ENTITLEMENT PRECEDENCE
============================================================

The canonical decision order is:

    Organization Entitlement
        ↓
    Notification Delivery Mode
        ↓
    Project Channel Eligibility
        ↓
    Project Routing
        ↓
    Member Preferences
        ↓
    Delivery Target

BUT:

When:

    connector_access = false

the pipeline MUST SHORT-CIRCUIT normal routing.

The resulting path becomes:

    Organization Entitlement
        ↓
    EMAIL_ONLY_RESTRICTED
        ↓
    Project Owner
        ↓
    Managed Email

Member preferences MUST NOT be evaluated in this mode.

============================================================
7. CANONICAL ROUTING SERVICE INTEGRATION
============================================================

The existing:

    NotificationRoutingService

is the only business-level notification routing boundary.

Extend it to perform:

    1. entitlement resolution
    2. delivery mode determination
    3. normal routing OR restricted routing

Conceptually:

    route(alertContext)

        ↓

    resolveNotificationDeliveryMode()

        ↓

    if NORMAL_CONNECTOR:
        resolve normal project channels
        resolve connector subscriptions
        resolve member preferences
        resolve quiet hours
        resolve silences
        resolve escalation target
        return delivery targets

    if EMAIL_ONLY_RESTRICTED:
        resolve project owner
        resolve owner email
        return exactly one managed-email target

Do NOT allow downstream services to change this decision.

============================================================
8. EMAIL-ONLY RESTRICTED MODE
============================================================

Create a dedicated routing path.

Preferred conceptual location:

    src/modules/alerting/runtime/email-only-restricted-routing.ts

Keep this implementation small and deterministic.

The function should conceptually perform:

    resolveProjectOwner(projectId)

        ↓

    validate owner belongs to organization/project

        ↓

    verify owner is active

        ↓

    resolve canonical verified email

        ↓

    normalize email

        ↓

    create managed-email delivery target

The returned target MUST explicitly identify:

    deliveryMode = EMAIL_ONLY_RESTRICTED

    recipientType = PROJECT_OWNER

    provider = MANAGED_EMAIL

    projectId

    organizationId

    alertId

Do not represent this as a customer connector.

============================================================
9. PROJECT OWNER RESOLUTION
============================================================

Determine the actual project ownership model from the existing schema.

DO NOT invent:

    owner_id

if the actual system uses another ownership relationship.

Use the canonical project owner/member relationship.

The owner MUST be resolved server-side.

Never trust:

    ownerId

    memberId

    recipientId

supplied by the frontend.

Validate:

    organization
        ↓
    project
        ↓
    owner

The owner must belong to the correct project/organization.

============================================================
10. OWNER EMAIL ELIGIBILITY
============================================================

Determine the canonical user email verification field from the existing
auth/user schema.

DO NOT guess the field name.

The project owner must have an eligible verified email.

If owner email is unavailable:

DO NOT silently notify all project members.

DO NOT bypass the entitlement.

DO NOT select a customer connector.

Return a deterministic suppression/failure outcome such as:

    OWNER_EMAIL_UNAVAILABLE

The alert itself remains valid.

The notification layer records:

    no notification target

with an explicit reason.

============================================================
11. PROJECT CHANNEL BEHAVIOR
============================================================

When:

    connector_access = false

existing project channels MUST NOT be deleted automatically.

Instead:

    eligible_for_delivery = false

for all non-email connector destinations.

Historical configuration must remain intact.

This is important because a later plan upgrade may restore eligibility.

The system must distinguish:

    configured

from:

    currently eligible

Example:

    Project Channel:
        Slack #backend

    configured = true
    entitlement_eligible = false
    delivery_allowed = false
    reason = CONNECTOR_ENTITLEMENT_REQUIRED

Do not mutate the channel into an email channel.

============================================================
12. EMAIL CHANNEL SEMANTICS
============================================================

When connector access is unavailable:

the effective delivery destination is:

    Managed Platform Email
    → Project Owner

This is NOT a customer-managed email connector.

Do not require:

    connector_configs

for the restricted email path.

Do not require:

    project_connector_subscriptions

for the restricted email path.

Do not route through:

    Slack queue
    Discord queue
    Teams queue
    Webhook queue
    PagerDuty queue
    SMS queue

Use the existing managed email infrastructure if one exists.

If the existing managed email transport is not suitable for this path,
create the smallest transport adapter necessary.

Do not create a second email infrastructure.

============================================================
13. MEMBER PREFERENCES MUST BE BYPASSED
============================================================

This is a hard requirement.

When:

    connector_access = false

the following MUST NOT determine recipients:

    project_member_alert_channel_preferences

    member_ids

    member severity thresholds

    member category preferences

    member digest preferences

    member quiet hours

    member channel subscriptions

The recipient set is:

    { projectOwner }

ONLY.

Example:

Project:

    Owner = Alice

Members:

    Alice
    Bob
    Charlie

Bob:
    alerts enabled

Charlie:
    alerts enabled

Connector entitlement:
    false

Alert:
    critical

Result:

    Alice → Email
    Bob → NO
    Charlie → NO

Even if Bob and Charlie have every alert preference enabled.

============================================================
14. NORMAL MODE MEMBER ROUTING
============================================================

When:

    connector_access = true

normal member routing remains active.

The routing path becomes:

    Alert
        ↓
    Project channels
        ↓
    Connector subscriptions
        ↓
    Member preferences
        ↓
    Eligible recipients
        ↓
    Provider

Do not force the project owner to receive every alert in normal mode.

Owner-only behavior applies ONLY to restricted mode.

============================================================
15. NO-CHANNEL FALLBACK IN NORMAL MODE
============================================================

Preserve the existing consolidation-plan behavior:

If connector access is available but no eligible project channel exists:

    project members
        ↓
    existing member eligibility rules
        ↓
    verified emails
        ↓
    managed email fallback

This is different from restricted mode.

NORMAL MODE:

    no eligible channel
        ↓
    project-member email fallback

RESTRICTED MODE:

    connector entitlement unavailable
        ↓
    project-owner-only email

Do not merge these two cases.

============================================================
16. ESCALATION
============================================================

Escalation MUST respect entitlement.

When:

    connector_access = false

an escalation step MUST NOT:

- send Slack
- send Discord
- send Teams
- send PagerDuty
- send webhook
- send SMS
- expand to additional members

If the product requires escalation while restricted:

    escalation target resolves to project owner
    ↓
    managed email

If the current escalation policy requires a connector unavailable under
the plan:

    record an explicit suppressed/blocked escalation outcome

Do not silently reroute to arbitrary members.

Escalation workers MUST call the canonical routing service.

They must never directly enqueue provider jobs.

============================================================
17. SILENCE / MUTE
============================================================

Silence and mute remain higher-level notification suppression mechanisms.

If alert is silenced:

    alert exists
    notification is suppressed

If alert is not silenced:

    entitlement determines delivery mode.

Do not use entitlement as an alert suppression mechanism.

An alert can exist even when connector access is unavailable.

============================================================
18. NOTIFICATION JOB CONTRACT
============================================================

The canonical router must create a complete notification job.

For restricted mode, the job must explicitly contain:

    organizationId
    projectId
    alertEventId
    notificationType
    deliveryMode = EMAIL_ONLY_RESTRICTED
    recipientType = PROJECT_OWNER
    recipientUserId
    normalizedRecipient
    provider = MANAGED_EMAIL
    idempotencyKey
    routingDecisionHash

Do not put:

    connectorId

on a restricted managed-email job unless the existing transport contract
requires a nullable field.

Do not invent a fake connector.

============================================================
19. QUEUE IS NOT THE POLICY LAYER
============================================================

The queue must transport the already-resolved decision.

The queue/worker MUST NOT decide:

- which member receives the alert
- whether Slack is allowed
- whether the organization has connector access
- whether fallback should be email
- whether the project owner should receive it

Those decisions belong to:

    NotificationRoutingService

The worker is transport-only.

============================================================
20. DEFENSE IN DEPTH AT WORKER LEVEL
============================================================

Although routing is canonical, workers must still validate critical
authorization state before external delivery.

If a notification job says:

    provider = Slack

but the organization's connector entitlement is currently disabled:

DO NOT send it.

Record:

    DELIVERY_BLOCKED_ENTITLEMENT

Do not endlessly retry it.

If the job was created under a valid entitlement and the entitlement
changed before delivery, the worker must fail closed.

Do NOT automatically transform that job into an owner email job inside
the worker.

If fallback is required, create a new canonical routing decision through
the routing layer.

Never let transport workers perform business routing.

============================================================
21. PLAN DOWNGRADE
============================================================

Test:

    connector access = true
        ↓
    Slack delivery works
        ↓
    organization plan changes
        ↓
    connector access = false

After the entitlement change:

1. Existing non-email channels remain stored.
2. Existing connector subscriptions remain stored.
3. Non-email channels become delivery-ineligible.
4. New alerts use EMAIL_ONLY_RESTRICTED.
5. Project member preferences are bypassed.
6. Project owner receives managed email.
7. Existing queued connector jobs are handled safely.
8. Blocked jobs do not retry forever.
9. No duplicate owner email is created accidentally.
10. No cross-project fallback occurs.

Determine whether entitlement changes are cached.

If cached, define and test cache invalidation/TTL behavior.

Do not assume entitlement changes are instantly visible if the existing
billing architecture uses caching.

============================================================
22. PLAN UPGRADE
============================================================

Test:

    connector access = false
        ↓
    owner-only email
        ↓
    plan upgraded
        ↓
    connector access = true

Expected:

1. Existing project channels remain intact.
2. Previously ineligible connector channels become eligible if their
   connector/subscription configuration is valid.
3. Normal project routing resumes.
4. Member preferences become active again.
5. Owner-only restriction ends.
6. No historical alerts are re-sent merely because entitlement changed.

============================================================
23. API ENFORCEMENT
============================================================

Frontend restrictions are NOT sufficient.

Backend APIs must prevent connector configuration changes when the plan
does not permit connector access.

Audit all:

- connector creation
- connector update
- connector subscription
- project channel creation
- project channel update
- routing rule creation
- routing rule update
- escalation configuration
- notification test endpoints

For connector-restricted plans:

non-email connector creation/configuration MUST fail with a typed
entitlement error.

Do not rely on the UI hiding the button.

Existing configuration may remain stored but must be marked unavailable
for delivery.

============================================================
24. NOTIFICATION TEST ENDPOINTS
============================================================

Audit test-send endpoints carefully.

A user must not be able to bypass entitlement by calling:

    POST /connectors/:id/test
    POST /alert-channels/:id/test
    POST /notifications/test

directly.

Every test delivery must respect:

    organization entitlement
    ↓
    project authorization
    ↓
    connector eligibility

If connector access is disabled:

    connector test = denied

Do not silently send the test through another provider.

============================================================
25. BILLING FAILURE BEHAVIOR
============================================================

Determine the existing billing entitlement failure semantics.

If the entitlement service is unavailable:

DO NOT fail open and allow connectors.

For safety:

    unknown entitlement
        ↓
    deny connector delivery

But do not necessarily block alert creation.

Correct behavior:

    alert evaluation = continues

    notification delivery:
        connector capability unknown
            ↓
        fail closed / controlled suppression
            OR
        use explicitly supported safe managed-email fallback

Choose the behavior according to the existing billing reliability
contract and document it.

Do not invent fail-open behavior.

============================================================
26. TENANT ISOLATION
============================================================

Verify restricted-mode owner resolution cannot leak data.

Project A must never resolve:

    Project B owner
    Project B members
    Project B email
    Project B connector

Every owner query must constrain:

    organizationId
    projectId

and validate the relationship.

============================================================
27. AUDIT LOGGING
============================================================

Record structured, tenant-safe reasons for routing decisions.

Examples:

    NORMAL_CONNECTOR_ROUTING

    EMAIL_ONLY_RESTRICTED

    CONNECTOR_ENTITLEMENT_REQUIRED

    OWNER_EMAIL_UNAVAILABLE

    NO_ELIGIBLE_CHANNEL

    MEMBER_PREFERENCE_SUPPRESSED

    SILENCED

    CONNECTOR_DISABLED

Do not log:

- connector secrets
- OAuth tokens
- webhook secrets
- raw recipient PII
- credentials

Use IDs/hashes where appropriate.

============================================================
28. OBSERVABILITY METRICS
============================================================

Add metrics for:

    notification.routing.normal
    notification.routing.email_only_restricted
    notification.routing.entitlement_blocked
    notification.routing.owner_fallback
    notification.routing.no_recipient
    notification.delivery.entitlement_blocked
    notification.connector.test_denied

Include:

    organizationId
    projectId
    alertId
    ruleId

using the repository's tenant-safe telemetry conventions.

============================================================
29. IDEMPOTENCY
============================================================

Restricted mode must be idempotent.

Repeated evaluations of the same alert must NOT send multiple owner
emails unintentionally.

Use the existing canonical V2 idempotency model.

The destination identity must include the normalized owner recipient
and notification type.

Example conceptual identity:

    alertEventId
    +
    projectOwnerUserId
    +
    normalizedEmail
    +
    notificationType
    +
    escalationStep

Do not create duplicate owner-email jobs during:

- worker retries
- process crashes
- duplicate evaluations
- escalation retries
- entitlement changes

============================================================
30. DATABASE
============================================================

Do NOT create a new connector-entitlement table if billing already owns
this concept.

Do NOT duplicate plan state into alerting unless the existing architecture
already requires a snapshot/cache.

If notification jobs require an audit snapshot, store the resolved
delivery mode:

    NORMAL_CONNECTOR
    EMAIL_ONLY_RESTRICTED

This protects historical interpretation of the job.

The current entitlement remains authoritative for preventing delivery
through a now-invalid connector.

============================================================
31. TEST MATRIX
============================================================

Create comprehensive tests.

----------------------------------------
TEST GROUP A — NORMAL CONNECTOR MODE
----------------------------------------

Organization:
connector access = true

Project:
owner = Alice

Members:
Alice, Bob, Charlie

Project:
Slack channel configured

Expected:
normal routing.

----------------------------------------
TEST GROUP B — MEMBER TARGETING
----------------------------------------

Connector access = true.

Bob:
enabled

Charlie:
disabled

Expected:
Bob can receive according to channel/routing policy.
Charlie does not.

----------------------------------------
TEST GROUP C — NO CHANNEL NORMAL MODE
----------------------------------------

Connector access = true.

No eligible project channel.

Expected:

project-member email fallback according to existing member rules.

----------------------------------------
TEST GROUP D — RESTRICTED MODE
----------------------------------------

Connector access = false.

Project:
owner = Alice

Members:
Alice, Bob, Charlie

Bob:
alerts enabled

Charlie:
alerts enabled

Expected:

Alice → one managed email

Bob → none

Charlie → none

Slack → none

Discord → none

Webhook → none

PagerDuty → none

SMS → none

----------------------------------------
TEST GROUP E — RESTRICTED MODE WITH EXISTING SLACK
----------------------------------------

Project has:

Slack channel
Slack connector subscription

Organization:
connector access = false

Expected:

Slack configuration remains stored.

Slack is ineligible.

No Slack job.

Owner email only.

----------------------------------------
TEST GROUP F — RESTRICTED MODE WITH MEMBER_IDS
----------------------------------------

Connector subscription contains:

member_ids = [Bob, Charlie]

Expected:

member_ids are ignored in restricted mode.

Only owner receives email.

----------------------------------------
TEST GROUP G — RESTRICTED MODE ESCALATION
----------------------------------------

Escalation policy references:

Slack
PagerDuty
member targets

Connector access = false

Expected:

No connector escalation.

Owner-only managed email according to escalation policy semantics.

No member expansion.

----------------------------------------
TEST GROUP H — PLAN DOWNGRADE
----------------------------------------

Start:
connector access = true.

Slack notification succeeds.

Change plan:
connector access = false.

Next alert:

owner email only.

----------------------------------------
TEST GROUP I — PLAN UPGRADE
----------------------------------------

Start:
connector access = false.

Owner email.

Upgrade:
connector access = true.

Next alert:

normal project routing resumes.

----------------------------------------
TEST GROUP J — OWNER INVALID
----------------------------------------

Connector access = false.

Project owner has no verified email.

Expected:

no recipient.

explicit OWNER_EMAIL_UNAVAILABLE outcome.

No member fallback.

No connector fallback.

----------------------------------------
TEST GROUP K — TENANT ISOLATION
----------------------------------------

Project A cannot resolve:

Project B owner
Project B email
Project B connector
Project B members

----------------------------------------
TEST GROUP L — DIRECT API BYPASS
----------------------------------------

Attempt direct connector test/create/subscription APIs while entitlement
is disabled.

Expected:

typed entitlement denial.

No provider call.

----------------------------------------
TEST GROUP M — WORKER DEFENSE
----------------------------------------

Create a queued Slack job.

Disable connector entitlement before worker executes.

Expected:

Slack delivery blocked.

No infinite retry.

No automatic worker-side rerouting.

Explicit delivery status/reason recorded.

============================================================
32. ACCEPTANCE CRITICAL SCENARIO
============================================================

This exact scenario MUST pass.

Organization:

    connector_access = false

Project:

    owner = User A

Members:

    User A
    User B
    User C

Project configuration:

    Slack channel exists
    Discord channel exists
    Email is available

Member preferences:

    User B = enabled
    User C = enabled

Connector subscriptions:

    Slack enabled
    Discord enabled

Alert:

    critical

Expected final state:

    Alert:
        CREATED

    Routing mode:
        EMAIL_ONLY_RESTRICTED

    Recipients:
        User A ONLY

    User B:
        NO NOTIFICATION

    User C:
        NO NOTIFICATION

    Slack:
        NOT USED

    Discord:
        NOT USED

    Connector queues:
        ZERO

    Managed email queue:
        ONE JOB

    Notification jobs:
        EXACTLY ONE

    Provider:
        MANAGED EMAIL

    Idempotency:
        ONE UNIQUE DELIVERY

This test is mandatory.

============================================================
33. ARCHITECTURAL INVARIANTS
============================================================

After implementation the following MUST be true:

INVARIANT 1:

Organization entitlement controls connector capability.

INVARIANT 2:

Frontend cannot bypass entitlement.

INVARIANT 3:

API cannot bypass entitlement.

INVARIANT 4:

Notification router cannot bypass entitlement.

INVARIANT 5:

Connector workers cannot bypass entitlement.

INVARIANT 6:

No connector entitlement means no connector delivery.

INVARIANT 7:

No connector entitlement means EMAIL_ONLY_RESTRICTED.

INVARIANT 8:

Restricted mode sends only to the project owner.

INVARIANT 9:

Restricted mode does not evaluate member preferences.

INVARIANT 10:

Restricted mode does not use member_ids.

INVARIANT 11:

Restricted mode does not use customer-managed email connectors.

INVARIANT 12:

Restricted mode uses platform-managed email.

INVARIANT 13:

Normal connector-enabled mode preserves project/member routing.

INVARIANT 14:

No-channel fallback and entitlement fallback are different behaviors.

INVARIANT 15:

Existing channels are preserved when entitlement changes.

INVARIANT 16:

Historical configuration is not destroyed by plan changes.

INVARIANT 17:

All delivery decisions are tenant-isolated.

INVARIANT 18:

All notification decisions are deterministic and idempotent.

INVARIANT 19:

Transport workers do not perform business routing.

INVARIANT 20:

There is one canonical notification routing decision path.

============================================================
34. IMPLEMENTATION QUALITY
============================================================

Use enterprise-grade standards.

Requirements:

- strict TypeScript
- typed contracts
- no any unless unavoidable
- dependency injection
- clear domain boundaries
- billing/alerting separation
- typed entitlement errors
- typed routing decisions
- deterministic state transitions
- idempotency
- structured logging
- metrics
- transaction safety
- tenant isolation
- concurrency safety
- no N+1 queries
- no secrets in logs
- no raw PII in logs
- no duplicated routing logic
- no provider-specific logic in alert evaluation
- no billing-specific SQL inside routing service
- no business logic inside transport workers

Keep the implementation small.

Do not create unnecessary abstractions.

============================================================
35. IMPLEMENTATION ORDER
============================================================

Execute in this exact order:

PHASE 1:
Inspect existing billing entitlement system.

PHASE 2:
Define canonical NotificationDeliveryMode contract.

PHASE 3:
Implement entitlement resolver using existing billing service.

PHASE 4:
Integrate entitlement gate into NotificationRoutingService.

PHASE 5:
Implement EMAIL_ONLY_RESTRICTED owner-only routing.

PHASE 6:
Implement explicit managed-email delivery target.

PHASE 7:
Add worker defense for stale/invalid connector jobs.

PHASE 8:
Enforce entitlement in connector/channel/test APIs.

PHASE 9:
Implement plan downgrade/upgrade behavior.

PHASE 10:
Add tests.

PHASE 11:
Run build/lint/unit/integration tests.

PHASE 12:
Perform final runtime call-graph audit.

============================================================
36. DO NOT
============================================================

DO NOT:

- create another billing system
- duplicate subscription state
- create another routing service
- create another connector abstraction
- convert Slack channels into email channels
- delete existing channels on downgrade
- notify all members when connector access is unavailable
- use member preferences in restricted mode
- use member_ids in restricted mode
- create a fake connector for managed email
- let connector workers decide fallback
- silently fail open when entitlement is unknown
- bypass entitlement in test endpoints
- create duplicate owner emails
- use frontend checks as security
- change organization alert rules
- modify alert evaluation semantics
- introduce Redis/BullMQ
- create provider×severity queues

============================================================
37. FINAL VERIFICATION
============================================================

After implementation produce:

1. Entitlement source used.
2. Exact entitlement key/feature used.
3. NotificationDeliveryMode implementation.
4. NotificationRoutingService call graph.
5. Restricted-mode call graph.
6. Owner resolution implementation.
7. Managed-email transport path.
8. Normal-mode routing path.
9. API enforcement points.
10. Worker defense.
11. Plan downgrade behavior.
12. Plan upgrade behavior.
13. Tests added.
14. Test results.
15. Files changed.
16. Migrations changed, if any.
17. Remaining risks.

Final runtime call graph MUST clearly show:

NORMAL:

    Alert
      ↓
    NotificationRoutingService
      ↓
    Entitlement = CONNECTOR_ALLOWED
      ↓
    Project Channels
      ↓
    Connector Subscriptions
      ↓
    Member Preferences
      ↓
    Delivery Targets
      ↓
    Notification Jobs
      ↓
    Provider Queue
      ↓
    Worker
      ↓
    Provider

RESTRICTED:

    Alert
      ↓
    NotificationRoutingService
      ↓
    Entitlement = CONNECTOR_NOT_ALLOWED
      ↓
    EMAIL_ONLY_RESTRICTED
      ↓
    Project Owner
      ↓
    Managed Email Target
      ↓
    Notification Job
      ↓
    Managed Email Queue
      ↓
    Email Worker
      ↓
    Project Owner

There must be no path from restricted mode to:

    Slack
    Discord
    Teams
    PagerDuty
    Webhook
    SMS
    arbitrary project members

Completion requires code evidence and tests proving these invariants.