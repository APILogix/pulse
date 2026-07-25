# MODULE KNOWLEDGE BASE: ALERTING

> **Code Intelligence Static Analysis Report**
> **Module Path:** `src/modules/alerting`
> **Health Score:** 78/100

---

## 1. Executive Summary & Purpose

The **alerting** module provides core bounded-context capabilities within the backend domain architecture.

- **Controllers:** 0
- **Services:** 8
- **Repositories:** 8
- **Discovered Routes:** 39
- **Owned Database Tables:** None directly owned
- **External Integrations:** None

---

## 2. Architecture & Folder Structure

### Folder Structure
```
src/modules/alerting/
├── alert-analysis.ts
├── alerting.module.ts
├── batch-processor.ts
├── common.ts
├── escalation.ts
├── presets.ts
├── rule-evaluator.ts
├── rule-templates.ts
├── evaluator.ts
├── events.repository.ts
├── events.routes.ts
├── events.service.ts
├── events.types.ts
├── fingerprint.ts
├── metrics.repository.ts
├── metrics.routes.ts
├── metrics.service.ts
├── metrics.types.ts
├── notifier.ts
├── policies.repository.ts
├── policies.routes.ts
├── policies.service.ts
├── policies.types.ts
├── queue.ts
├── repository.ts
├── routes.ts
├── routing.repository.ts
├── routing.routes.ts
├── routing.service.ts
├── routing.types.ts
```

### Module Boundaries & Dependencies
- **Imported Modules:** None (Standalone Module)
- **Layering Compliance:** Controller → Service → Repository pattern strictly followed.

---

## 3. Route Inventory & Execution Flow

### Route Table
| Method | Path | Auth | Scoped | Handler | Rate Limit |
|---|---|---|---|---|---|
| `POST` | `/events` | ❌ No | Global | `src/modules/alerting/events/events.routes.ts` | Standard (60/min) |
| `GET` | `/events` | ❌ No | Global | `src/modules/alerting/events/events.routes.ts` | Standard (60/min) |
| `GET` | `/events/stats` | ❌ No | Global | `src/modules/alerting/events/events.routes.ts` | Standard (60/min) |
| `GET` | `/events/:id` | ❌ No | Global | `src/modules/alerting/events/events.routes.ts` | Standard (60/min) |
| `POST` | `/events/:id/acknowledge` | ❌ No | Global | `src/modules/alerting/events/events.routes.ts` | Standard (60/min) |
| `POST` | `/events/:id/resolve` | ❌ No | Global | `src/modules/alerting/events/events.routes.ts` | Standard (60/min) |
| `POST` | `/events/:id/silence` | ❌ No | Global | `src/modules/alerting/events/events.routes.ts` | Standard (60/min) |
| `GET` | `/events/:id/deliveries` | ❌ No | Global | `src/modules/alerting/events/events.routes.ts` | Standard (60/min) |
| `GET` | `/dead-letters` | ❌ No | Global | `src/modules/alerting/events/events.routes.ts` | Standard (60/min) |
| `POST` | `/dead-letters/:id/retry` | ❌ No | Global | `src/modules/alerting/events/events.routes.ts` | Standard (60/min) |
| `DELETE` | `/dead-letters/:id` | ❌ No | Global | `src/modules/alerting/events/events.routes.ts` | Standard (60/min) |
| `GET` | `/metrics` | ❌ No | Global | `src/modules/alerting/metrics/metrics.routes.ts` | Standard (60/min) |
| `POST` | `/escalation-policies` | ❌ No | Global | `src/modules/alerting/policies/policies.routes.ts` | Standard (60/min) |
| `GET` | `/escalation-policies` | ❌ No | Global | `src/modules/alerting/policies/policies.routes.ts` | Standard (60/min) |
| `GET` | `/escalation-policies/:id` | ❌ No | Global | `src/modules/alerting/policies/policies.routes.ts` | Standard (60/min) |
| `DELETE` | `/escalation-policies/:id` | ❌ No | Global | `src/modules/alerting/policies/policies.routes.ts` | Standard (60/min) |
| `PUT` | `/escalation-policies/:id/steps` | ❌ No | Global | `src/modules/alerting/policies/policies.routes.ts` | Standard (60/min) |
| `POST` | `/routing-rules` | ❌ No | Global | `src/modules/alerting/routing/routing.routes.ts` | Standard (60/min) |
| `GET` | `/routing-rules` | ❌ No | Global | `src/modules/alerting/routing/routing.routes.ts` | Standard (60/min) |
| `DELETE` | `/routing-rules/:id` | ❌ No | Global | `src/modules/alerting/routing/routing.routes.ts` | Standard (60/min) |
| `POST` | `/routing-rules/test` | ❌ No | Global | `src/modules/alerting/routing/routing.routes.ts` | Standard (60/min) |
| `POST` | `/rules` | ❌ No | Global | `src/modules/alerting/rules/rules.routes.ts` | Standard (60/min) |
| `GET` | `/rules/templates` | ❌ No | Global | `src/modules/alerting/rules/rules.routes.ts` | Standard (60/min) |
| `POST` | `/rules/templates/:templateKey` | ❌ No | Global | `src/modules/alerting/rules/rules.routes.ts` | Standard (60/min) |
| `GET` | `/rules` | ❌ No | Global | `src/modules/alerting/rules/rules.routes.ts` | Standard (60/min) |
| `GET` | `/rules/:id` | ❌ No | Global | `src/modules/alerting/rules/rules.routes.ts` | Standard (60/min) |
| `PATCH` | `/rules/:id` | ❌ No | Global | `src/modules/alerting/rules/rules.routes.ts` | Standard (60/min) |
| `DELETE` | `/rules/:id` | ❌ No | Global | `src/modules/alerting/rules/rules.routes.ts` | Standard (60/min) |
| `POST` | `/rules/:id/enable` | ❌ No | Global | `src/modules/alerting/rules/rules.routes.ts` | Standard (60/min) |
| `POST` | `/rules/:id/disable` | ❌ No | Global | `src/modules/alerting/rules/rules.routes.ts` | Standard (60/min) |
| `POST` | `/rules/:id/test` | ❌ No | Global | `src/modules/alerting/rules/rules.routes.ts` | Standard (60/min) |
| `POST` | `/rules/:id/clone` | ❌ No | Global | `src/modules/alerting/rules/rules.routes.ts` | Standard (60/min) |
| `POST` | `/silences` | ❌ No | Global | `src/modules/alerting/silences/silences.routes.ts` | Standard (60/min) |
| `GET` | `/silences` | ❌ No | Global | `src/modules/alerting/silences/silences.routes.ts` | Standard (60/min) |
| `DELETE` | `/silences/:id` | ❌ No | Global | `src/modules/alerting/silences/silences.routes.ts` | Standard (60/min) |
| `POST` | `/templates` | ❌ No | Global | `src/modules/alerting/templates/templates.routes.ts` | Standard (60/min) |
| `GET` | `/templates` | ❌ No | Global | `src/modules/alerting/templates/templates.routes.ts` | Standard (60/min) |
| `DELETE` | `/templates/:id` | ❌ No | Global | `src/modules/alerting/templates/templates.routes.ts` | Standard (60/min) |
| `POST` | `/templates/:id/preview` | ❌ No | Global | `src/modules/alerting/templates/templates.routes.ts` | Standard (60/min) |

### Detailed Execution Trace Sample
```
HTTP Request (POST /events)
  ↓
[Middleware] Fastify Plugin / Body Parser
  ↓
[Auth Guard] Public Route
  ↓
[Validation] Zod Schema Validation
  ↓
[Controller] alertingController
  ↓
[Service] AlertingService
  ↓
[Repository] AlertingRepository
  ↓
[Database SQL] PostgreSQL / ClickHouse Query
  ↓
HTTP Response (200 OK / JSON)
```

---

## 4. Services & Business Logic


### AlertingService
- **Source File:** `src/modules/alerting/service.ts`
- **Methods:** `createRule()`, `listRules()`, `getRule()`, `updateRule()`, `deleteRule()`, `setRuleEnabled()`, `cloneRule()`, `listRuleTemplates()`, `createRuleFromTemplate()`, `testRule()`, `ingestEvent()`, `listEvents()`, `getEvent()`, `getEventDeliveries()`, `acknowledgeEvent()`, `resolveEvent()`, `silenceFromEvent()`, `listDeadLetters()`, `retryDeadLetter()`, `discardDeadLetter()`, `createSilence()`, `listSilences()`, `expireSilence()`, `createEscalationPolicy()`, `listEscalationPolicies()`, `getEscalationPolicy()`, `deleteEscalationPolicy()`, `upsertEscalationStep()`, `createTemplate()`, `listTemplates()`, `deleteTemplate()`, `previewTemplate()`, `createRoutingRule()`, `listRoutingRules()`, `deleteRoutingRule()`, `testRouting()`, `getMetrics()`, `getStats()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/service").AlertingServiceDeps
- **External Calls:** None


### EventsService
- **Source File:** `src/modules/alerting/events/events.service.ts`
- **Methods:** `ingestEvent()`, `listEvents()`, `getEvent()`, `getEventDeliveries()`, `listDeadLetters()`, `retryDeadLetter()`, `discardDeadLetter()`, `acknowledgeEvent()`, `resolveEvent()`, `silenceFromEvent()`, `computeAutoResolveAt()`, `requireRule()`, `requireEvent()`, `audit()`, `eventToDto()`, `deadLetterToDto()`, `silenceToDto()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/events/events.service").AlertingServiceDeps
- **External Calls:** None


### MetricsService
- **Source File:** `src/modules/alerting/metrics/metrics.service.ts`
- **Methods:** `getMetrics()`, `getStats()`, `audit()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/metrics/metrics.service").AlertingServiceDeps
- **External Calls:** None


### PoliciesService
- **Source File:** `src/modules/alerting/policies/policies.service.ts`
- **Methods:** `createEscalationPolicy()`, `listEscalationPolicies()`, `getEscalationPolicy()`, `deleteEscalationPolicy()`, `upsertEscalationStep()`, `audit()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/policies/policies.service").AlertingServiceDeps
- **External Calls:** None


### RoutingService
- **Source File:** `src/modules/alerting/routing/routing.service.ts`
- **Methods:** `createRoutingRule()`, `listRoutingRules()`, `deleteRoutingRule()`, `testRouting()`, `audit()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/routing/routing.service").AlertingServiceDeps
- **External Calls:** None


### RulesService
- **Source File:** `src/modules/alerting/rules/rules.service.ts`
- **Methods:** `createRule()`, `listRules()`, `getRule()`, `updateRule()`, `deleteRule()`, `setRuleEnabled()`, `cloneRule()`, `listRuleTemplates()`, `createRuleFromTemplate()`, `testRule()`, `audit()`, `ruleToDto()`, `requireRule()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/rules/rules.service").AlertingServiceDeps
- **External Calls:** None


### SilencesService
- **Source File:** `src/modules/alerting/silences/silences.service.ts`
- **Methods:** `createSilence()`, `listSilences()`, `expireSilence()`, `audit()`, `silenceToDto()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/silences/silences.service").AlertingServiceDeps
- **External Calls:** None


### TemplatesService
- **Source File:** `src/modules/alerting/templates/templates.service.ts`
- **Methods:** `createTemplate()`, `listTemplates()`, `deleteTemplate()`, `previewTemplate()`, `audit()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/templates/templates.service").AlertingServiceDeps
- **External Calls:** None


---

## 5. Repositories & Database Operations


### AlertingRepository
- **Source File:** `src/modules/alerting/repository.ts`
- **Methods:** `withTransaction()`, `createRule()`, `findRuleById()`, `getRuleConditions()`, `getRuleActions()`, `getRuleActionsByRuleIds()`, `listRules()`, `updateRule()`, `softDeleteRule()`, `setRuleEnabled()`, `findActiveEventByFingerprint()`, `incrementDuplicate()`, `insertEvent()`, `findEventById()`, `listEvents()`, `acknowledgeEvent()`, `resolveEvent()`, `insertHistory()`, `getEventHistory()`, `getEventDeliveries()`, `createBatchFromPending()`, `getBatchWithEvents()`, `completeBatch()`, `bulkUpdateEventStatus()`, `bulkInsertDeliveryAttempts()`, `findOrgsWithPendingEvents()`, `claimAutoResolvable()`, `claimEscalationDue()`, `advanceEscalation()`, `resumeExpiredAcknowledgments()`, `requeueStuckProcessingEvents()`, `failStaleBatches()`, `setBatchJobId()`, `getThrottleStates()`, `recordThrottleNotifications()`, `insertDeadLetter()`, `listDeadLetters()`, `findDeadLetterById()`, `claimRetryableDeadLetters()`, `markDeadLetterRetried()`, `markDeadLetterExhausted()`, `discardDeadLetter()`, `purgeOldTerminalEvents()`, `purgeOldBatches()`, `purgeOldDeliveryAttempts()`, `purgeOldDeadLetters()`, `purgeOldThrottleWindows()`, `createSilence()`, `listSilences()`, `expireSilence()`, `findActiveSilences()`, `createEscalationPolicy()`, `listEscalationPolicies()`, `findEscalationPolicy()`, `deleteEscalationPolicy()`, `upsertEscalationStep()`, `listEscalationSteps()`, `listEscalationStepsByPolicyIds()`, `createTemplate()`, `findTemplate()`, `listTemplates()`, `deleteTemplate()`, `createRoutingRule()`, `listRoutingRules()`, `findRoutingRule()`, `deleteRoutingRule()`, `queryMetrics()`, `getRealtimeStats()`
- **Tables Touched:** `metrics`
- **Transactions:** ❌ Simple Queries Only


### EventsRepository
- **Source File:** `src/modules/alerting/events/events.repository.ts`
- **Methods:** `withTransaction()`, `findActiveEventByFingerprint()`, `incrementDuplicate()`, `insertEvent()`, `findEventById()`, `listEvents()`, `acknowledgeEvent()`, `resolveEvent()`, `insertHistory()`, `getEventHistory()`, `getEventDeliveries()`, `createBatchFromPending()`, `getBatchWithEvents()`, `completeBatch()`, `bulkUpdateEventStatus()`, `bulkInsertDeliveryAttempts()`, `findOrgsWithPendingEvents()`, `claimAutoResolvable()`, `claimEscalationDue()`, `advanceEscalation()`, `resumeExpiredAcknowledgments()`, `requeueStuckProcessingEvents()`, `failStaleBatches()`, `setBatchJobId()`, `getThrottleStates()`, `recordThrottleNotifications()`, `insertDeadLetter()`, `listDeadLetters()`, `findDeadLetterById()`, `claimRetryableDeadLetters()`, `markDeadLetterRetried()`, `markDeadLetterExhausted()`, `discardDeadLetter()`, `purgeOldTerminalEvents()`, `purgeOldBatches()`, `purgeOldDeliveryAttempts()`, `purgeOldDeadLetters()`, `purgeOldThrottleWindows()`
- **Tables Touched:** `alert_events`, `alert_event_history`, `alert_acknowledgments`, `alert_event_batches`, `alert_delivery_attempts`, `alert_throttle_windows`, `alert_dead_letter_events`, `metrics`
- **Transactions:** ✅ Uses Database Transactions


### MetricsRepository
- **Source File:** `src/modules/alerting/metrics/metrics.repository.ts`
- **Methods:** `withTransaction()`, `queryMetrics()`, `getRealtimeStats()`
- **Tables Touched:** `alert_events`, `alert_metrics`, `metrics`
- **Transactions:** ✅ Uses Database Transactions


### PoliciesRepository
- **Source File:** `src/modules/alerting/policies/policies.repository.ts`
- **Methods:** `withTransaction()`, `createEscalationPolicy()`, `listEscalationPolicies()`, `findEscalationPolicy()`, `deleteEscalationPolicy()`, `upsertEscalationStep()`, `listEscalationSteps()`, `listEscalationStepsByPolicyIds()`
- **Tables Touched:** `alert_escalation_policies`, `alert_escalation_steps`, `metrics`
- **Transactions:** ✅ Uses Database Transactions


### RoutingRepository
- **Source File:** `src/modules/alerting/routing/routing.repository.ts`
- **Methods:** `withTransaction()`, `createRoutingRule()`, `listRoutingRules()`, `findRoutingRule()`, `deleteRoutingRule()`
- **Tables Touched:** `alert_routing_rules`, `metrics`
- **Transactions:** ✅ Uses Database Transactions


### RulesRepository
- **Source File:** `src/modules/alerting/rules/rules.repository.ts`
- **Methods:** `withTransaction()`, `createRule()`, `insertConditions()`, `insertActions()`, `findRuleById()`, `getRuleConditions()`, `getRuleActions()`, `getRuleActionsByRuleIds()`, `listRules()`, `updateRule()`, `softDeleteRule()`, `setRuleEnabled()`
- **Tables Touched:** `alert_rules`, `alert_rule_conditions`, `alert_rule_actions`, `metrics`
- **Transactions:** ✅ Uses Database Transactions


### SilencesRepository
- **Source File:** `src/modules/alerting/silences/silences.repository.ts`
- **Methods:** `withTransaction()`, `createSilence()`, `listSilences()`, `expireSilence()`, `findActiveSilences()`
- **Tables Touched:** `alert_silences`, `metrics`
- **Transactions:** ✅ Uses Database Transactions


### TemplatesRepository
- **Source File:** `src/modules/alerting/templates/templates.repository.ts`
- **Methods:** `withTransaction()`, `createTemplate()`, `findTemplate()`, `listTemplates()`, `deleteTemplate()`
- **Tables Touched:** `alert_templates`, `metrics`
- **Transactions:** ✅ Uses Database Transactions


---

## 6. Database Tables & Ownership Matrix


| Table Name | Role | Columns | Indexes | Foreign Keys |
|---|---|---|---|---|
| `metrics` | Reader/Writer | 17 | 2 | 0 |
| `alert_events` | Reader/Writer | 36 | 12 | 1 |
| `alert_event_history` | Reader/Writer | 11 | 2 | 0 |
| `alert_acknowledgments` | Reader/Writer | 10 | 2 | 0 |
| `alert_event_batches` | Reader/Writer | 17 | 3 | 0 |
| `alert_delivery_attempts` | Reader/Writer | 22 | 5 | 0 |
| `alert_throttle_windows` | Reader/Writer | 7 | 1 | 1 |
| `alert_dead_letter_events` | Reader/Writer | 18 | 2 | 0 |
| `alert_metrics` | Reader/Writer | 10 | 2 | 0 |
| `alert_escalation_policies` | Reader/Writer | 10 | 1 | 0 |
| `alert_escalation_steps` | Reader/Writer | 12 | 1 | 1 |
| `alert_routing_rules` | Reader/Writer | 14 | 2 | 0 |
| `alert_rules` | Reader/Writer | 24 | 7 | 0 |
| `alert_rule_conditions` | Reader/Writer | 14 | 2 | 0 |
| `alert_rule_actions` | Reader/Writer | 15 | 2 | 0 |
| `alert_silences` | Reader/Writer | 12 | 2 | 1 |
| `alert_templates` | Reader/Writer | 13 | 2 | 0 |


---

## 7. Event Bus & Queue Processing

- **Published Events:** None
- **Consumed Events:** None
- **Queue Jobs:** None

---

## 8. Enterprise Health Scorecard

| Domain | Score | Rating | Analysis |
|---|---|---|---|
| **Architecture** | 85/100 | Great | Bounded context isolation |
| **Security** | 60/100 | Needs Review | Route guards & input schemas |
| **Performance** | 82/100 | Great | Query efficiency & indexing |
| **Scalability** | 80/100 | Great | Stateless design |
| **Maintainability** | 85/100 | Great | Readable TS code & types |
| **Testing** | 75/100 | Moderate | Unit & integration coverage |
| **DDD Compliance** | 88/100 | Great | Domain model separation |
| **Overall Score** | **78/100** | **REMEDIATION NEEDED** | Core System Rating |

---

## 9. Actionable Recommendations

- **P1:** Ensure all endpoints in `alerting` implement strict rate limiting.
- **P2:** Expand unit test coverage for `AlertingService`.
- **P3:** Refactor raw SQL string concatenations into parameterised repository helpers where applicable.
