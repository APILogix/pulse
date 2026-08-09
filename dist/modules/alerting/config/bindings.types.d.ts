/**
 * Alert rule binding schemas (validation boundary).
 *
 * Architecture: docs/alerting-redesign/02-data-model.md §1
 *               docs/alerting-redesign/adr/0004-rule-inheritance-model.md
 *
 * The scope tuple is validated HERE so a malformed binding is rejected with a 422 and a
 * readable message, rather than surfacing as a Postgres CHECK violation. The database
 * constraint (`ck_alert_rule_binding_scope_shape`) remains the backstop — validation is
 * defence in depth, never a replacement for it.
 */
import { z } from 'zod';
import { type AlertScopeType } from '../policy/resolve-rule.js';
export declare const AlertScopeTypeSchema: z.ZodEnum<{
    service: "service";
    endpoint: "endpoint";
    environment: "environment";
    organization: "organization";
    project: "project";
}>;
export declare const AlertBindingModeSchema: z.ZodEnum<{
    disable: "disable";
    override: "override";
    inherit: "inherit";
}>;
export declare const AlertActionMergeModeSchema: z.ZodEnum<{
    replace: "replace";
    inherit: "inherit";
    merge: "merge";
}>;
export declare const NotificationChannelKindSchema: z.ZodEnum<{
    sms: "sms";
    email: "email";
    webhook: "webhook";
    in_app: "in_app";
    slack: "slack";
    discord: "discord";
    teams: "teams";
    pagerduty: "pagerduty";
}>;
export declare const CreateBindingSchema: z.ZodObject<{
    mode: z.ZodDefault<z.ZodEnum<{
        disable: "disable";
        override: "override";
        inherit: "inherit";
    }>>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    priority: z.ZodDefault<z.ZodNumber>;
    severity: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>>;
    cooldownSeconds: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    deduplicationWindowSeconds: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    autoResolveAfterMinutes: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    evaluationIntervalSeconds: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    consecutiveBreaches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    thresholdOverrides: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    actionMode: z.ZodDefault<z.ZodEnum<{
        replace: "replace";
        inherit: "inherit";
        merge: "merge";
    }>>;
    requestedChannels: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
        sms: "sms";
        email: "email";
        webhook: "webhook";
        in_app: "in_app";
        slack: "slack";
        discord: "discord";
        teams: "teams";
        pagerduty: "pagerduty";
    }>>>>;
    recipientOverrides: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    escalationPolicyId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    notes: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    scopeType: z.ZodEnum<{
        service: "service";
        endpoint: "endpoint";
        environment: "environment";
        organization: "organization";
        project: "project";
    }>;
    projectId: z.ZodOptional<z.ZodString>;
    environment: z.ZodOptional<z.ZodString>;
    service: z.ZodOptional<z.ZodString>;
    endpoint: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CreateBindingBody = z.infer<typeof CreateBindingSchema>;
/**
 * Updates never move a binding to a different scope — that would silently change which
 * evaluations it affects. Change the scope by deleting and recreating.
 */
export declare const UpdateBindingSchema: z.ZodObject<{
    mode: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
        disable: "disable";
        override: "override";
        inherit: "inherit";
    }>>>;
    enabled: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    priority: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    severity: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>>>;
    cooldownSeconds: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
    deduplicationWindowSeconds: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
    autoResolveAfterMinutes: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
    evaluationIntervalSeconds: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
    consecutiveBreaches: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
    thresholdOverrides: z.ZodOptional<z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    actionMode: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
        replace: "replace";
        inherit: "inherit";
        merge: "merge";
    }>>>;
    requestedChannels: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
        sms: "sms";
        email: "email";
        webhook: "webhook";
        in_app: "in_app";
        slack: "slack";
        discord: "discord";
        teams: "teams";
        pagerduty: "pagerduty";
    }>>>>>;
    recipientOverrides: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
    escalationPolicyId: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    notes: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
}, z.core.$strip>;
export type UpdateBindingBody = z.infer<typeof UpdateBindingSchema>;
/** Query for `GET /rules/:ruleId/effective`. */
export declare const EffectiveRuleQuerySchema: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodString>;
    environment: z.ZodOptional<z.ZodString>;
    service: z.ZodOptional<z.ZodString>;
    endpoint: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type EffectiveRuleQuery = z.infer<typeof EffectiveRuleQuerySchema>;
export declare const BindingParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    ruleId: z.ZodString;
}, z.core.$strip>;
export declare const BindingIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    ruleId: z.ZodString;
    bindingId: z.ZodString;
}, z.core.$strip>;
/** Derive the stored precedence level from the scope type (single source of truth). */
export declare function scopeLevelFor(scopeType: AlertScopeType): number;
//# sourceMappingURL=bindings.types.d.ts.map