import { z } from 'zod';
import { PaginationSchema } from '../types.js';
export const IncidentStatusSchema = z.enum(['open', 'acknowledged', 'resolved']);
export const IncidentSeveritySchema = z.enum(['info', 'warning', 'error', 'critical']);
export const ListIncidentsQuerySchema = PaginationSchema.extend({
    status: IncidentStatusSchema.optional(),
    /** Shorthand facet. Ignored when `status` is supplied. */
    active: z
        .enum(['true', 'false'])
        .transform((value) => value === 'true')
        .optional(),
    severity: IncidentSeveritySchema.optional(),
    projectId: z.string().uuid().optional(),
    environment: z.string().max(64).optional(),
    service: z.string().max(255).optional(),
    route: z.string().max(500).optional(),
    ruleId: z.string().uuid().optional(),
    assignedTo: z.string().uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    search: z.string().max(255).optional(),
});
export const IncidentIdParamsSchema = z.object({
    orgId: z.string().uuid(),
    incidentId: z.string().uuid(),
});
export const ResolveIncidentBodySchema = z.object({
    reason: z.string().max(100).optional(),
});
export const AssignIncidentBodySchema = z.object({
    /** null clears the assignment. */
    assigneeUserId: z.string().uuid().nullable(),
});
export const IncidentTimelineQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).default(0),
});
/** Lifecycle event kinds accepted as an activity filter. */
export const IncidentEventKindSchema = z.enum([
    'incident_opened',
    'condition_still_breaching',
    'incident_acknowledged',
    'incident_assigned',
    'incident_resolved',
    'incident_reopened',
    'incident_escalated',
    'notification_created',
    'notification_suppressed',
]);
/** Global activity feed query (Phase 22). Always paginated. */
export const ListActivityQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    kind: IncidentEventKindSchema.optional(),
    projectId: z.string().uuid().optional(),
    incidentId: z.string().uuid().optional(),
    severity: IncidentSeveritySchema.optional(),
    ruleId: z.string().uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    search: z.string().max(255).optional(),
});
/** Batched per-rule incident stats for the Alert Rules page (Phase 21). */
export const RuleIncidentStatsQuerySchema = z.object({
    /** Comma-separated rule ids, capped so the IN-list cannot grow unbounded. */
    ruleIds: z
        .string()
        .min(1)
        .transform((value) => value.split(',').map((id) => id.trim()).filter(Boolean))
        .refine((ids) => ids.length <= 200, { message: 'At most 200 ruleIds per request' })
        .refine((ids) => ids.every((id) => /^[0-9a-f-]{36}$/i.test(id)), {
        message: 'ruleIds must be UUIDs',
    }),
});
//# sourceMappingURL=incidents.types.js.map