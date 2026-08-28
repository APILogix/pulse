import { z } from 'zod';
export declare const IncidentStatusSchema: z.ZodEnum<{
    open: "open";
    resolved: "resolved";
    acknowledged: "acknowledged";
}>;
export declare const IncidentSeveritySchema: z.ZodEnum<{
    error: "error";
    info: "info";
    warning: "warning";
    critical: "critical";
}>;
export declare const ListIncidentsQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    status: z.ZodOptional<z.ZodEnum<{
        open: "open";
        resolved: "resolved";
        acknowledged: "acknowledged";
    }>>;
    active: z.ZodOptional<z.ZodPipe<z.ZodEnum<{
        true: "true";
        false: "false";
    }>, z.ZodTransform<boolean, "true" | "false">>>;
    severity: z.ZodOptional<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>;
    projectId: z.ZodOptional<z.ZodString>;
    environment: z.ZodOptional<z.ZodString>;
    service: z.ZodOptional<z.ZodString>;
    route: z.ZodOptional<z.ZodString>;
    ruleId: z.ZodOptional<z.ZodString>;
    assignedTo: z.ZodOptional<z.ZodString>;
    from: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    to: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    search: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const IncidentIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    incidentId: z.ZodString;
}, z.core.$strip>;
export declare const ResolveIncidentBodySchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const AssignIncidentBodySchema: z.ZodObject<{
    assigneeUserId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const IncidentTimelineQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type ListIncidentsQueryInput = z.infer<typeof ListIncidentsQuerySchema>;
export type ResolveIncidentBody = z.infer<typeof ResolveIncidentBodySchema>;
export type AssignIncidentBody = z.infer<typeof AssignIncidentBodySchema>;
export type IncidentTimelineQuery = z.infer<typeof IncidentTimelineQuerySchema>;
/** Wire shape returned to the frontend. camelCase, no internal columns leaked. */
export interface IncidentDto {
    id: string;
    organizationId: string;
    projectId: string | null;
    environment: string | null;
    ruleId: string | null;
    ruleRevision: number | null;
    fingerprint: string;
    dimensionKey: string;
    status: 'open' | 'acknowledged' | 'resolved';
    severity: 'info' | 'warning' | 'error' | 'critical';
    title: string;
    service: string | null;
    route: string | null;
    observedValue: number | null;
    thresholdValue: number | null;
    occurrenceCount: number;
    startedAt: string;
    lastSeenAt: string;
    /** Seconds from startedAt to resolvedAt, or to now while still active. */
    durationSeconds: number;
    acknowledgedAt: string | null;
    acknowledgedBy: string | null;
    assignedTo: string | null;
    resolvedAt: string | null;
    resolvedBy: string | null;
    resolutionReason: string | null;
    labels: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}
/** Lifecycle event kinds accepted as an activity filter. */
export declare const IncidentEventKindSchema: z.ZodEnum<{
    incident_opened: "incident_opened";
    condition_still_breaching: "condition_still_breaching";
    incident_acknowledged: "incident_acknowledged";
    incident_assigned: "incident_assigned";
    incident_resolved: "incident_resolved";
    incident_reopened: "incident_reopened";
    incident_escalated: "incident_escalated";
    notification_created: "notification_created";
    notification_suppressed: "notification_suppressed";
}>;
/** Global activity feed query (Phase 22). Always paginated. */
export declare const ListActivityQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    kind: z.ZodOptional<z.ZodEnum<{
        incident_opened: "incident_opened";
        condition_still_breaching: "condition_still_breaching";
        incident_acknowledged: "incident_acknowledged";
        incident_assigned: "incident_assigned";
        incident_resolved: "incident_resolved";
        incident_reopened: "incident_reopened";
        incident_escalated: "incident_escalated";
        notification_created: "notification_created";
        notification_suppressed: "notification_suppressed";
    }>>;
    projectId: z.ZodOptional<z.ZodString>;
    incidentId: z.ZodOptional<z.ZodString>;
    severity: z.ZodOptional<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>;
    ruleId: z.ZodOptional<z.ZodString>;
    from: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    to: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    search: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Batched per-rule incident stats for the Alert Rules page (Phase 21). */
export declare const RuleIncidentStatsQuerySchema: z.ZodObject<{
    ruleIds: z.ZodPipe<z.ZodString, z.ZodTransform<string[], string>>;
}, z.core.$strip>;
export type ListActivityQueryInput = z.infer<typeof ListActivityQuerySchema>;
export type RuleIncidentStatsQueryInput = z.infer<typeof RuleIncidentStatsQuerySchema>;
//# sourceMappingURL=incidents.types.d.ts.map