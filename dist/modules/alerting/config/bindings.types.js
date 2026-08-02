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
import { AlertSeveritySchema, UuidSchema } from '../common.js';
import { SCOPE_LEVEL } from '../policy/resolve-rule.js';
export const AlertScopeTypeSchema = z.enum([
    'organization', 'project', 'environment', 'service', 'endpoint',
]);
export const AlertBindingModeSchema = z.enum(['inherit', 'override', 'disable']);
export const AlertActionMergeModeSchema = z.enum(['inherit', 'merge', 'replace']);
export const NotificationChannelKindSchema = z.enum([
    'in_app', 'email', 'slack', 'discord', 'teams', 'pagerduty', 'webhook', 'sms',
]);
/** SDK environment contract, identical to the database CHECK. */
const EnvironmentSchema = z.string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'environment must match ^[A-Za-z0-9][A-Za-z0-9._-]*$');
const BindingScopeShape = {
    scopeType: AlertScopeTypeSchema,
    projectId: UuidSchema.optional(),
    environment: EnvironmentSchema.optional(),
    service: z.string().min(1).max(255).optional(),
    endpoint: z.string().min(1).max(500).optional(),
};
const BindingValueShape = {
    mode: AlertBindingModeSchema.default('inherit'),
    enabled: z.boolean().default(true),
    priority: z.number().int().min(0).max(100_000).default(100),
    // NULL/absent means inherit. `null` is accepted explicitly so a caller can CLEAR an
    // override and fall back to the parent scope.
    severity: AlertSeveritySchema.nullish(),
    cooldownSeconds: z.number().int().min(0).max(86_400).nullish(),
    deduplicationWindowSeconds: z.number().int().min(0).max(604_800).nullish(),
    autoResolveAfterMinutes: z.number().int().min(1).max(20_160).nullish(),
    evaluationIntervalSeconds: z.number().int().min(1).max(86_400).nullish(),
    consecutiveBreaches: z.number().int().min(1).max(1_000).nullish(),
    /** Per-condition overrides keyed by alert_rule_conditions.field_path. */
    thresholdOverrides: z.record(z.string().min(1).max(500), z.unknown()).default({}),
    actionMode: AlertActionMergeModeSchema.default('inherit'),
    /** Channel KINDS, never connector ids (ADR-0009). */
    requestedChannels: z.array(NotificationChannelKindSchema).max(16).nullish(),
    recipientOverrides: z.record(z.string(), z.unknown()).nullish(),
    escalationPolicyId: UuidSchema.nullish(),
    notes: z.string().max(2_000).nullish(),
};
/**
 * Enforce the same scope shape the database does: each level requires its own field and
 * forbids deeper ones.
 */
function refineScope(value, ctx) {
    const { scopeType, projectId, environment, service, endpoint } = value;
    const require = (field, present) => {
        if (present === undefined || present === null) {
            ctx.addIssue({
                code: 'custom',
                path: [field],
                message: `${field} is required for scopeType "${scopeType}"`,
            });
        }
    };
    const forbid = (field, present) => {
        if (present !== undefined && present !== null) {
            ctx.addIssue({
                code: 'custom',
                path: [field],
                message: `${field} is not allowed for scopeType "${scopeType}"`,
            });
        }
    };
    if (scopeType === 'organization') {
        forbid('projectId', projectId);
        forbid('environment', environment);
        forbid('service', service);
        forbid('endpoint', endpoint);
        return;
    }
    require('projectId', projectId);
    if (scopeType === 'project') {
        forbid('environment', environment);
        forbid('service', service);
        forbid('endpoint', endpoint);
    }
    else if (scopeType === 'environment') {
        require('environment', environment);
        forbid('service', service);
        forbid('endpoint', endpoint);
    }
    else if (scopeType === 'service') {
        require('service', service);
        forbid('endpoint', endpoint);
    }
    else if (scopeType === 'endpoint') {
        require('endpoint', endpoint);
    }
}
export const CreateBindingSchema = z.object({ ...BindingScopeShape, ...BindingValueShape })
    .superRefine(refineScope);
/**
 * Updates never move a binding to a different scope — that would silently change which
 * evaluations it affects. Change the scope by deleting and recreating.
 */
export const UpdateBindingSchema = z.object(BindingValueShape).partial();
/** Query for `GET /rules/:ruleId/effective`. */
export const EffectiveRuleQuerySchema = z.object({
    projectId: UuidSchema.optional(),
    environment: EnvironmentSchema.optional(),
    service: z.string().min(1).max(255).optional(),
    endpoint: z.string().min(1).max(500).optional(),
}).superRefine((value, ctx) => {
    // Deeper scopes are meaningless without a project, and silently ignoring them would
    // make the endpoint lie about what it resolved.
    if (!value.projectId && (value.environment || value.service || value.endpoint)) {
        ctx.addIssue({
            code: 'custom',
            path: ['projectId'],
            message: 'projectId is required when environment, service or endpoint is supplied',
        });
    }
});
export const BindingParamsSchema = z.object({
    orgId: UuidSchema,
    ruleId: UuidSchema,
});
export const BindingIdParamsSchema = z.object({
    orgId: UuidSchema,
    ruleId: UuidSchema,
    bindingId: UuidSchema,
});
/** Derive the stored precedence level from the scope type (single source of truth). */
export function scopeLevelFor(scopeType) {
    return SCOPE_LEVEL[scopeType];
}
//# sourceMappingURL=bindings.types.js.map