/**
 * Automation module – Zod v4 schemas for all public API inputs.
 *
 * Enforces: size/array/string limits, safe timezone/5-field cron,
 * project scope, risk/approval constraints, external webhook safety
 * metadata, JSON object shapes, and enum values.
 */
import { z } from 'zod';
export declare const UuidSchema: z.ZodString;
export declare const OrgIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
}, z.core.$strip>;
export declare const WorkflowIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    workflowId: z.ZodString;
}, z.core.$strip>;
export declare const RunIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    runId: z.ZodString;
}, z.core.$strip>;
export declare const ApprovalIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    approvalId: z.ZodString;
}, z.core.$strip>;
export declare const TemplateKeyParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    templateKey: z.ZodString;
}, z.core.$strip>;
export declare const PaginationSchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>;
export declare const TriggerDefinitionSchema: z.ZodObject<{
    triggerKind: z.ZodEnum<{
        schedule: "schedule";
        manual: "manual";
        event: "event";
        webhook: "webhook";
    }>;
    triggerType: z.ZodEnum<{
        "alert.event.created": "alert.event.created";
        "alert.event.acknowledged": "alert.event.acknowledged";
        "alert.event.resolved": "alert.event.resolved";
        "alert.event.escalated": "alert.event.escalated";
        "alert.rule.firing": "alert.rule.firing";
        "error.group.created": "error.group.created";
        "error.group.regressed": "error.group.regressed";
        "trace.latency.baseline_breached": "trace.latency.baseline_breached";
        "log.pattern.spike": "log.pattern.spike";
        "metric.threshold_breached": "metric.threshold_breached";
        "cron.missed": "cron.missed";
        "uptime.failed": "uptime.failed";
        "slo.burn_rate_breached": "slo.burn_rate_breached";
        "release.deployed": "release.deployed";
        "release.health_degraded": "release.health_degraded";
        "ai.root_cause.confidence_breached": "ai.root_cause.confidence_breached";
        "billing.usage.threshold_breached": "billing.usage.threshold_breached";
        "billing.plan.changed": "billing.plan.changed";
        "connector.delivery.failed": "connector.delivery.failed";
        "connector.delivery.dead_lettered": "connector.delivery.dead_lettered";
        "billing.webhook.dead_lettered": "billing.webhook.dead_lettered";
        "ingestion.dead_letter.created": "ingestion.dead_letter.created";
        "security.api_key.suspicious_usage": "security.api_key.suspicious_usage";
        "security.sso.failed_spike": "security.sso.failed_spike";
        "security.scim.failed_spike": "security.scim.failed_spike";
        "security.export.spike": "security.export.spike";
        "schedule.cron": "schedule.cron";
        "manual.run": "manual.run";
        "webhook.received": "webhook.received";
    }>;
    sourceModule: z.ZodString;
    sourceEvent: z.ZodOptional<z.ZodString>;
    scheduleCron: z.ZodOptional<z.ZodString>;
    timezone: z.ZodDefault<z.ZodString>;
    webhookSecretHash: z.ZodOptional<z.ZodString>;
    isEnabled: z.ZodDefault<z.ZodBoolean>;
    dedupeKeyTemplate: z.ZodOptional<z.ZodString>;
    cooldownSeconds: z.ZodDefault<z.ZodNumber>;
    config: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const ConditionDefinitionSchema: z.ZodObject<{
    conditionGroup: z.ZodDefault<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodNumber>;
    leftPath: z.ZodString;
    operator: z.ZodEnum<{
        in: "in";
        gt: "gt";
        lt: "lt";
        gte: "gte";
        lte: "lte";
        eq: "eq";
        neq: "neq";
        contains: "contains";
        exists: "exists";
        not_in: "not_in";
        not_contains: "not_contains";
        matches: "matches";
        not_exists: "not_exists";
        between: "between";
    }>;
    rightValue: z.ZodOptional<z.ZodUnknown>;
    valueType: z.ZodDefault<z.ZodString>;
    isRequired: z.ZodDefault<z.ZodBoolean>;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const ActionDefinitionSchema: z.ZodObject<{
    actionKey: z.ZodString;
    actionType: z.ZodEnum<{
        "notification.send": "notification.send";
        "incident.create": "incident.create";
        "incident.assign_owner": "incident.assign_owner";
        "incident.timeline.append": "incident.timeline.append";
        "incident.postmortem.generate_draft": "incident.postmortem.generate_draft";
        "ticket.github.create": "ticket.github.create";
        "ticket.jira.create": "ticket.jira.create";
        "pagerduty.trigger": "pagerduty.trigger";
        "runbook.open": "runbook.open";
        "runbook.step.create": "runbook.step.create";
        "status_page.update": "status_page.update";
        "approval.request": "approval.request";
        "connector.delivery.retry": "connector.delivery.retry";
        "alert.severity.change": "alert.severity.change";
        "alert.silence.create": "alert.silence.create";
        "ai.summary.generate": "ai.summary.generate";
        "ai.root_cause.generate": "ai.root_cause.generate";
        "report.export": "report.export";
        "rollback.recommend": "rollback.recommend";
        "release.guard.warn": "release.guard.warn";
        "release.guard.pause": "release.guard.pause";
        "quota.notify": "quota.notify";
        "quota.throttle_recommend": "quota.throttle_recommend";
        "retention.archive": "retention.archive";
        "retention.purge_request": "retention.purge_request";
        "security.notify": "security.notify";
        "webhook.call": "webhook.call";
        noop: "noop";
    }>;
    integrationKey: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodNumber>;
    isEnabled: z.ZodDefault<z.ZodBoolean>;
    requiresApproval: z.ZodDefault<z.ZodBoolean>;
    riskLevel: z.ZodDefault<z.ZodEnum<{
        critical: "critical";
        low: "low";
        medium: "medium";
        high: "high";
    }>>;
    timeoutSeconds: z.ZodDefault<z.ZodNumber>;
    maxAttempts: z.ZodDefault<z.ZodNumber>;
    retryBackoffSeconds: z.ZodDefault<z.ZodNumber>;
    idempotencyKeyTemplate: z.ZodOptional<z.ZodString>;
    config: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const SafetyDefinitionSchema: z.ZodObject<{
    maxRunsPerHour: z.ZodDefault<z.ZodNumber>;
    dedupeWindowSeconds: z.ZodDefault<z.ZodNumber>;
    requiresApprovalAboveRisk: z.ZodDefault<z.ZodEnum<{
        critical: "critical";
        low: "low";
        medium: "medium";
        high: "high";
    }>>;
}, z.core.$strip>;
export declare const WebhookSafetyMetadataSchema: z.ZodObject<{
    isAllowlisted: z.ZodDefault<z.ZodBoolean>;
    targetUrl: z.ZodOptional<z.ZodString>;
    safeHeaders: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    requireTls: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const CreateWorkflowSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    workflowType: z.ZodEnum<{
        report: "report";
        security: "security";
        custom: "custom";
        dead_letter: "dead_letter";
        escalation: "escalation";
        connector: "connector";
        anomaly: "anomaly";
        alert_routing: "alert_routing";
        incident_creation: "incident_creation";
        incident_timeline: "incident_timeline";
        postmortem: "postmortem";
        release_guard: "release_guard";
        rollback_recommendation: "rollback_recommendation";
        noise_reduction: "noise_reduction";
        remediation: "remediation";
        runbook: "runbook";
        data_retention: "data_retention";
        quota: "quota";
    }>;
    scope: z.ZodDefault<z.ZodEnum<{
        organization: "organization";
        project: "project";
        platform: "platform";
    }>>;
    projectId: z.ZodOptional<z.ZodString>;
    trigger: z.ZodObject<{
        triggerKind: z.ZodEnum<{
            schedule: "schedule";
            manual: "manual";
            event: "event";
            webhook: "webhook";
        }>;
        triggerType: z.ZodEnum<{
            "alert.event.created": "alert.event.created";
            "alert.event.acknowledged": "alert.event.acknowledged";
            "alert.event.resolved": "alert.event.resolved";
            "alert.event.escalated": "alert.event.escalated";
            "alert.rule.firing": "alert.rule.firing";
            "error.group.created": "error.group.created";
            "error.group.regressed": "error.group.regressed";
            "trace.latency.baseline_breached": "trace.latency.baseline_breached";
            "log.pattern.spike": "log.pattern.spike";
            "metric.threshold_breached": "metric.threshold_breached";
            "cron.missed": "cron.missed";
            "uptime.failed": "uptime.failed";
            "slo.burn_rate_breached": "slo.burn_rate_breached";
            "release.deployed": "release.deployed";
            "release.health_degraded": "release.health_degraded";
            "ai.root_cause.confidence_breached": "ai.root_cause.confidence_breached";
            "billing.usage.threshold_breached": "billing.usage.threshold_breached";
            "billing.plan.changed": "billing.plan.changed";
            "connector.delivery.failed": "connector.delivery.failed";
            "connector.delivery.dead_lettered": "connector.delivery.dead_lettered";
            "billing.webhook.dead_lettered": "billing.webhook.dead_lettered";
            "ingestion.dead_letter.created": "ingestion.dead_letter.created";
            "security.api_key.suspicious_usage": "security.api_key.suspicious_usage";
            "security.sso.failed_spike": "security.sso.failed_spike";
            "security.scim.failed_spike": "security.scim.failed_spike";
            "security.export.spike": "security.export.spike";
            "schedule.cron": "schedule.cron";
            "manual.run": "manual.run";
            "webhook.received": "webhook.received";
        }>;
        sourceModule: z.ZodString;
        sourceEvent: z.ZodOptional<z.ZodString>;
        scheduleCron: z.ZodOptional<z.ZodString>;
        timezone: z.ZodDefault<z.ZodString>;
        webhookSecretHash: z.ZodOptional<z.ZodString>;
        isEnabled: z.ZodDefault<z.ZodBoolean>;
        dedupeKeyTemplate: z.ZodOptional<z.ZodString>;
        cooldownSeconds: z.ZodDefault<z.ZodNumber>;
        config: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>;
    conditions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        conditionGroup: z.ZodDefault<z.ZodString>;
        sortOrder: z.ZodDefault<z.ZodNumber>;
        leftPath: z.ZodString;
        operator: z.ZodEnum<{
            in: "in";
            gt: "gt";
            lt: "lt";
            gte: "gte";
            lte: "lte";
            eq: "eq";
            neq: "neq";
            contains: "contains";
            exists: "exists";
            not_in: "not_in";
            not_contains: "not_contains";
            matches: "matches";
            not_exists: "not_exists";
            between: "between";
        }>;
        rightValue: z.ZodOptional<z.ZodUnknown>;
        valueType: z.ZodDefault<z.ZodString>;
        isRequired: z.ZodDefault<z.ZodBoolean>;
        metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>>;
    actions: z.ZodArray<z.ZodObject<{
        actionKey: z.ZodString;
        actionType: z.ZodEnum<{
            "notification.send": "notification.send";
            "incident.create": "incident.create";
            "incident.assign_owner": "incident.assign_owner";
            "incident.timeline.append": "incident.timeline.append";
            "incident.postmortem.generate_draft": "incident.postmortem.generate_draft";
            "ticket.github.create": "ticket.github.create";
            "ticket.jira.create": "ticket.jira.create";
            "pagerduty.trigger": "pagerduty.trigger";
            "runbook.open": "runbook.open";
            "runbook.step.create": "runbook.step.create";
            "status_page.update": "status_page.update";
            "approval.request": "approval.request";
            "connector.delivery.retry": "connector.delivery.retry";
            "alert.severity.change": "alert.severity.change";
            "alert.silence.create": "alert.silence.create";
            "ai.summary.generate": "ai.summary.generate";
            "ai.root_cause.generate": "ai.root_cause.generate";
            "report.export": "report.export";
            "rollback.recommend": "rollback.recommend";
            "release.guard.warn": "release.guard.warn";
            "release.guard.pause": "release.guard.pause";
            "quota.notify": "quota.notify";
            "quota.throttle_recommend": "quota.throttle_recommend";
            "retention.archive": "retention.archive";
            "retention.purge_request": "retention.purge_request";
            "security.notify": "security.notify";
            "webhook.call": "webhook.call";
            noop: "noop";
        }>;
        integrationKey: z.ZodOptional<z.ZodString>;
        sortOrder: z.ZodDefault<z.ZodNumber>;
        isEnabled: z.ZodDefault<z.ZodBoolean>;
        requiresApproval: z.ZodDefault<z.ZodBoolean>;
        riskLevel: z.ZodDefault<z.ZodEnum<{
            critical: "critical";
            low: "low";
            medium: "medium";
            high: "high";
        }>>;
        timeoutSeconds: z.ZodDefault<z.ZodNumber>;
        maxAttempts: z.ZodDefault<z.ZodNumber>;
        retryBackoffSeconds: z.ZodDefault<z.ZodNumber>;
        idempotencyKeyTemplate: z.ZodOptional<z.ZodString>;
        config: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
    safety: z.ZodOptional<z.ZodObject<{
        maxRunsPerHour: z.ZodDefault<z.ZodNumber>;
        dedupeWindowSeconds: z.ZodDefault<z.ZodNumber>;
        requiresApprovalAboveRisk: z.ZodDefault<z.ZodEnum<{
            critical: "critical";
            low: "low";
            medium: "medium";
            high: "high";
        }>>;
    }, z.core.$strip>>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    timezone: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export declare const UpdateWorkflowSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    trigger: z.ZodOptional<z.ZodObject<{
        triggerKind: z.ZodEnum<{
            schedule: "schedule";
            manual: "manual";
            event: "event";
            webhook: "webhook";
        }>;
        triggerType: z.ZodEnum<{
            "alert.event.created": "alert.event.created";
            "alert.event.acknowledged": "alert.event.acknowledged";
            "alert.event.resolved": "alert.event.resolved";
            "alert.event.escalated": "alert.event.escalated";
            "alert.rule.firing": "alert.rule.firing";
            "error.group.created": "error.group.created";
            "error.group.regressed": "error.group.regressed";
            "trace.latency.baseline_breached": "trace.latency.baseline_breached";
            "log.pattern.spike": "log.pattern.spike";
            "metric.threshold_breached": "metric.threshold_breached";
            "cron.missed": "cron.missed";
            "uptime.failed": "uptime.failed";
            "slo.burn_rate_breached": "slo.burn_rate_breached";
            "release.deployed": "release.deployed";
            "release.health_degraded": "release.health_degraded";
            "ai.root_cause.confidence_breached": "ai.root_cause.confidence_breached";
            "billing.usage.threshold_breached": "billing.usage.threshold_breached";
            "billing.plan.changed": "billing.plan.changed";
            "connector.delivery.failed": "connector.delivery.failed";
            "connector.delivery.dead_lettered": "connector.delivery.dead_lettered";
            "billing.webhook.dead_lettered": "billing.webhook.dead_lettered";
            "ingestion.dead_letter.created": "ingestion.dead_letter.created";
            "security.api_key.suspicious_usage": "security.api_key.suspicious_usage";
            "security.sso.failed_spike": "security.sso.failed_spike";
            "security.scim.failed_spike": "security.scim.failed_spike";
            "security.export.spike": "security.export.spike";
            "schedule.cron": "schedule.cron";
            "manual.run": "manual.run";
            "webhook.received": "webhook.received";
        }>;
        sourceModule: z.ZodString;
        sourceEvent: z.ZodOptional<z.ZodString>;
        scheduleCron: z.ZodOptional<z.ZodString>;
        timezone: z.ZodDefault<z.ZodString>;
        webhookSecretHash: z.ZodOptional<z.ZodString>;
        isEnabled: z.ZodDefault<z.ZodBoolean>;
        dedupeKeyTemplate: z.ZodOptional<z.ZodString>;
        cooldownSeconds: z.ZodDefault<z.ZodNumber>;
        config: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
    conditions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        conditionGroup: z.ZodDefault<z.ZodString>;
        sortOrder: z.ZodDefault<z.ZodNumber>;
        leftPath: z.ZodString;
        operator: z.ZodEnum<{
            in: "in";
            gt: "gt";
            lt: "lt";
            gte: "gte";
            lte: "lte";
            eq: "eq";
            neq: "neq";
            contains: "contains";
            exists: "exists";
            not_in: "not_in";
            not_contains: "not_contains";
            matches: "matches";
            not_exists: "not_exists";
            between: "between";
        }>;
        rightValue: z.ZodOptional<z.ZodUnknown>;
        valueType: z.ZodDefault<z.ZodString>;
        isRequired: z.ZodDefault<z.ZodBoolean>;
        metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>>;
    actions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        actionKey: z.ZodString;
        actionType: z.ZodEnum<{
            "notification.send": "notification.send";
            "incident.create": "incident.create";
            "incident.assign_owner": "incident.assign_owner";
            "incident.timeline.append": "incident.timeline.append";
            "incident.postmortem.generate_draft": "incident.postmortem.generate_draft";
            "ticket.github.create": "ticket.github.create";
            "ticket.jira.create": "ticket.jira.create";
            "pagerduty.trigger": "pagerduty.trigger";
            "runbook.open": "runbook.open";
            "runbook.step.create": "runbook.step.create";
            "status_page.update": "status_page.update";
            "approval.request": "approval.request";
            "connector.delivery.retry": "connector.delivery.retry";
            "alert.severity.change": "alert.severity.change";
            "alert.silence.create": "alert.silence.create";
            "ai.summary.generate": "ai.summary.generate";
            "ai.root_cause.generate": "ai.root_cause.generate";
            "report.export": "report.export";
            "rollback.recommend": "rollback.recommend";
            "release.guard.warn": "release.guard.warn";
            "release.guard.pause": "release.guard.pause";
            "quota.notify": "quota.notify";
            "quota.throttle_recommend": "quota.throttle_recommend";
            "retention.archive": "retention.archive";
            "retention.purge_request": "retention.purge_request";
            "security.notify": "security.notify";
            "webhook.call": "webhook.call";
            noop: "noop";
        }>;
        integrationKey: z.ZodOptional<z.ZodString>;
        sortOrder: z.ZodDefault<z.ZodNumber>;
        isEnabled: z.ZodDefault<z.ZodBoolean>;
        requiresApproval: z.ZodDefault<z.ZodBoolean>;
        riskLevel: z.ZodDefault<z.ZodEnum<{
            critical: "critical";
            low: "low";
            medium: "medium";
            high: "high";
        }>>;
        timeoutSeconds: z.ZodDefault<z.ZodNumber>;
        maxAttempts: z.ZodDefault<z.ZodNumber>;
        retryBackoffSeconds: z.ZodDefault<z.ZodNumber>;
        idempotencyKeyTemplate: z.ZodOptional<z.ZodString>;
        config: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>>;
    safety: z.ZodOptional<z.ZodObject<{
        maxRunsPerHour: z.ZodDefault<z.ZodNumber>;
        dedupeWindowSeconds: z.ZodDefault<z.ZodNumber>;
        requiresApprovalAboveRisk: z.ZodDefault<z.ZodEnum<{
            critical: "critical";
            low: "low";
            medium: "medium";
            high: "high";
        }>>;
    }, z.core.$strip>>;
    tags: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
    metadata: z.ZodOptional<z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    timezone: z.ZodOptional<z.ZodDefault<z.ZodString>>;
}, z.core.$strip>;
export declare const PublishWorkflowSchema: z.ZodObject<{
    activateOnPublish: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const ManualRunSchema: z.ZodObject<{
    inputPayload: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const TestWorkflowSchema: z.ZodObject<{
    simulatedPayload: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    dryRun: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const ListWorkflowsQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        archived: "archived";
        paused: "paused";
        draft: "draft";
        disabled: "disabled";
    }>>;
    workflowType: z.ZodOptional<z.ZodEnum<{
        report: "report";
        security: "security";
        custom: "custom";
        dead_letter: "dead_letter";
        escalation: "escalation";
        connector: "connector";
        anomaly: "anomaly";
        alert_routing: "alert_routing";
        incident_creation: "incident_creation";
        incident_timeline: "incident_timeline";
        postmortem: "postmortem";
        release_guard: "release_guard";
        rollback_recommendation: "rollback_recommendation";
        noise_reduction: "noise_reduction";
        remediation: "remediation";
        runbook: "runbook";
        data_retention: "data_retention";
        quota: "quota";
    }>>;
    isEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    projectId: z.ZodOptional<z.ZodString>;
    search: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const ListRunsQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    status: z.ZodOptional<z.ZodEnum<{
        running: "running";
        cancelled: "cancelled";
        queued: "queued";
        succeeded: "succeeded";
        failed: "failed";
        skipped: "skipped";
        waiting_approval: "waiting_approval";
        timed_out: "timed_out";
    }>>;
    workflowId: z.ZodOptional<z.ZodString>;
    triggerType: z.ZodOptional<z.ZodEnum<{
        "alert.event.created": "alert.event.created";
        "alert.event.acknowledged": "alert.event.acknowledged";
        "alert.event.resolved": "alert.event.resolved";
        "alert.event.escalated": "alert.event.escalated";
        "alert.rule.firing": "alert.rule.firing";
        "error.group.created": "error.group.created";
        "error.group.regressed": "error.group.regressed";
        "trace.latency.baseline_breached": "trace.latency.baseline_breached";
        "log.pattern.spike": "log.pattern.spike";
        "metric.threshold_breached": "metric.threshold_breached";
        "cron.missed": "cron.missed";
        "uptime.failed": "uptime.failed";
        "slo.burn_rate_breached": "slo.burn_rate_breached";
        "release.deployed": "release.deployed";
        "release.health_degraded": "release.health_degraded";
        "ai.root_cause.confidence_breached": "ai.root_cause.confidence_breached";
        "billing.usage.threshold_breached": "billing.usage.threshold_breached";
        "billing.plan.changed": "billing.plan.changed";
        "connector.delivery.failed": "connector.delivery.failed";
        "connector.delivery.dead_lettered": "connector.delivery.dead_lettered";
        "billing.webhook.dead_lettered": "billing.webhook.dead_lettered";
        "ingestion.dead_letter.created": "ingestion.dead_letter.created";
        "security.api_key.suspicious_usage": "security.api_key.suspicious_usage";
        "security.sso.failed_spike": "security.sso.failed_spike";
        "security.scim.failed_spike": "security.scim.failed_spike";
        "security.export.spike": "security.export.spike";
        "schedule.cron": "schedule.cron";
        "manual.run": "manual.run";
        "webhook.received": "webhook.received";
    }>>;
}, z.core.$strip>;
export declare const CancelRunSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const RetryRunSchema: z.ZodObject<{
    fromStep: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const ApproveApprovalSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
    decisionPayload: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const RejectApprovalSchema: z.ZodObject<{
    reason: z.ZodString;
    decisionPayload: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const CreateFromTemplateSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    projectId: z.ZodOptional<z.ZodString>;
    configOverrides: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const IngestEventSchema: z.ZodObject<{
    sourceModule: z.ZodString;
    eventType: z.ZodEnum<{
        "alert.event.created": "alert.event.created";
        "alert.event.acknowledged": "alert.event.acknowledged";
        "alert.event.resolved": "alert.event.resolved";
        "alert.event.escalated": "alert.event.escalated";
        "alert.rule.firing": "alert.rule.firing";
        "error.group.created": "error.group.created";
        "error.group.regressed": "error.group.regressed";
        "trace.latency.baseline_breached": "trace.latency.baseline_breached";
        "log.pattern.spike": "log.pattern.spike";
        "metric.threshold_breached": "metric.threshold_breached";
        "cron.missed": "cron.missed";
        "uptime.failed": "uptime.failed";
        "slo.burn_rate_breached": "slo.burn_rate_breached";
        "release.deployed": "release.deployed";
        "release.health_degraded": "release.health_degraded";
        "ai.root_cause.confidence_breached": "ai.root_cause.confidence_breached";
        "billing.usage.threshold_breached": "billing.usage.threshold_breached";
        "billing.plan.changed": "billing.plan.changed";
        "connector.delivery.failed": "connector.delivery.failed";
        "connector.delivery.dead_lettered": "connector.delivery.dead_lettered";
        "billing.webhook.dead_lettered": "billing.webhook.dead_lettered";
        "ingestion.dead_letter.created": "ingestion.dead_letter.created";
        "security.api_key.suspicious_usage": "security.api_key.suspicious_usage";
        "security.sso.failed_spike": "security.sso.failed_spike";
        "security.scim.failed_spike": "security.scim.failed_spike";
        "security.export.spike": "security.export.spike";
        "schedule.cron": "schedule.cron";
        "manual.run": "manual.run";
        "webhook.received": "webhook.received";
    }>;
    sourceEventId: z.ZodOptional<z.ZodString>;
    dedupeKey: z.ZodString;
    payload: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    projectId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const ListAuditQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    workflowId: z.ZodOptional<z.ZodString>;
    runId: z.ZodOptional<z.ZodString>;
    action: z.ZodOptional<z.ZodString>;
    actorUserId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const ListApprovalsQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    status: z.ZodOptional<z.ZodEnum<{
        expired: "expired";
        pending: "pending";
        approved: "approved";
        rejected: "rejected";
        cancelled: "cancelled";
    }>>;
    workflowId: z.ZodOptional<z.ZodString>;
    riskLevel: z.ZodOptional<z.ZodEnum<{
        critical: "critical";
        low: "low";
        medium: "medium";
        high: "high";
    }>>;
}, z.core.$strip>;
export declare const TemplateDefinitionSchema: z.ZodObject<{
    schemaVersion: z.ZodNumber;
    workflowType: z.ZodEnum<{
        report: "report";
        security: "security";
        custom: "custom";
        dead_letter: "dead_letter";
        escalation: "escalation";
        connector: "connector";
        anomaly: "anomaly";
        alert_routing: "alert_routing";
        incident_creation: "incident_creation";
        incident_timeline: "incident_timeline";
        postmortem: "postmortem";
        release_guard: "release_guard";
        rollback_recommendation: "rollback_recommendation";
        noise_reduction: "noise_reduction";
        remediation: "remediation";
        runbook: "runbook";
        data_retention: "data_retention";
        quota: "quota";
    }>;
    trigger: z.ZodObject<{
        kind: z.ZodEnum<{
            schedule: "schedule";
            manual: "manual";
            event: "event";
            webhook: "webhook";
        }>;
        type: z.ZodEnum<{
            "alert.event.created": "alert.event.created";
            "alert.event.acknowledged": "alert.event.acknowledged";
            "alert.event.resolved": "alert.event.resolved";
            "alert.event.escalated": "alert.event.escalated";
            "alert.rule.firing": "alert.rule.firing";
            "error.group.created": "error.group.created";
            "error.group.regressed": "error.group.regressed";
            "trace.latency.baseline_breached": "trace.latency.baseline_breached";
            "log.pattern.spike": "log.pattern.spike";
            "metric.threshold_breached": "metric.threshold_breached";
            "cron.missed": "cron.missed";
            "uptime.failed": "uptime.failed";
            "slo.burn_rate_breached": "slo.burn_rate_breached";
            "release.deployed": "release.deployed";
            "release.health_degraded": "release.health_degraded";
            "ai.root_cause.confidence_breached": "ai.root_cause.confidence_breached";
            "billing.usage.threshold_breached": "billing.usage.threshold_breached";
            "billing.plan.changed": "billing.plan.changed";
            "connector.delivery.failed": "connector.delivery.failed";
            "connector.delivery.dead_lettered": "connector.delivery.dead_lettered";
            "billing.webhook.dead_lettered": "billing.webhook.dead_lettered";
            "ingestion.dead_letter.created": "ingestion.dead_letter.created";
            "security.api_key.suspicious_usage": "security.api_key.suspicious_usage";
            "security.sso.failed_spike": "security.sso.failed_spike";
            "security.scim.failed_spike": "security.scim.failed_spike";
            "security.export.spike": "security.export.spike";
            "schedule.cron": "schedule.cron";
            "manual.run": "manual.run";
            "webhook.received": "webhook.received";
        }>;
        sourceModule: z.ZodString;
    }, z.core.$strip>;
    conditions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        leftPath: z.ZodString;
        operator: z.ZodEnum<{
            in: "in";
            gt: "gt";
            lt: "lt";
            gte: "gte";
            lte: "lte";
            eq: "eq";
            neq: "neq";
            contains: "contains";
            exists: "exists";
            not_in: "not_in";
            not_contains: "not_contains";
            matches: "matches";
            not_exists: "not_exists";
            between: "between";
        }>;
        rightValue: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strip>>>;
    actions: z.ZodArray<z.ZodObject<{
        actionKey: z.ZodString;
        actionType: z.ZodEnum<{
            "notification.send": "notification.send";
            "incident.create": "incident.create";
            "incident.assign_owner": "incident.assign_owner";
            "incident.timeline.append": "incident.timeline.append";
            "incident.postmortem.generate_draft": "incident.postmortem.generate_draft";
            "ticket.github.create": "ticket.github.create";
            "ticket.jira.create": "ticket.jira.create";
            "pagerduty.trigger": "pagerduty.trigger";
            "runbook.open": "runbook.open";
            "runbook.step.create": "runbook.step.create";
            "status_page.update": "status_page.update";
            "approval.request": "approval.request";
            "connector.delivery.retry": "connector.delivery.retry";
            "alert.severity.change": "alert.severity.change";
            "alert.silence.create": "alert.silence.create";
            "ai.summary.generate": "ai.summary.generate";
            "ai.root_cause.generate": "ai.root_cause.generate";
            "report.export": "report.export";
            "rollback.recommend": "rollback.recommend";
            "release.guard.warn": "release.guard.warn";
            "release.guard.pause": "release.guard.pause";
            "quota.notify": "quota.notify";
            "quota.throttle_recommend": "quota.throttle_recommend";
            "retention.archive": "retention.archive";
            "retention.purge_request": "retention.purge_request";
            "security.notify": "security.notify";
            "webhook.call": "webhook.call";
            noop: "noop";
        }>;
        riskLevel: z.ZodDefault<z.ZodEnum<{
            critical: "critical";
            low: "low";
            medium: "medium";
            high: "high";
        }>>;
        requiresApproval: z.ZodDefault<z.ZodBoolean>;
        config: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
    safety: z.ZodOptional<z.ZodObject<{
        maxRunsPerHour: z.ZodDefault<z.ZodNumber>;
        dedupeWindowSeconds: z.ZodDefault<z.ZodNumber>;
        requiresApprovalAboveRisk: z.ZodDefault<z.ZodEnum<{
            critical: "critical";
            low: "low";
            medium: "medium";
            high: "high";
        }>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
//# sourceMappingURL=schemas.d.ts.map