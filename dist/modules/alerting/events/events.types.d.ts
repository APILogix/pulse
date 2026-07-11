import { z } from 'zod';
import { type AlertSeverity } from '../common.js';
export declare const AlertEventStatusSchema: z.ZodEnum<{
    error: "error";
    pending: "pending";
    processing: "processing";
    firing: "firing";
    resolved: "resolved";
    acknowledged: "acknowledged";
    suppressed: "suppressed";
    silenced: "silenced";
}>;
export type AlertEventStatus = z.infer<typeof AlertEventStatusSchema>;
export declare const DeliveryAttemptStatusSchema: z.ZodEnum<{
    pending: "pending";
    cancelled: "cancelled";
    failed: "failed";
    queued: "queued";
    sent: "sent";
    delivered: "delivered";
    retrying: "retrying";
}>;
export type DeliveryAttemptStatus = z.infer<typeof DeliveryAttemptStatusSchema>;
export declare const BatchStatusSchema: z.ZodEnum<{
    pending: "pending";
    processing: "processing";
    failed: "failed";
    completed: "completed";
    partial: "partial";
}>;
export type BatchStatus = z.infer<typeof BatchStatusSchema>;
export declare const HistoryActionSchema: z.ZodEnum<{
    resolved: "resolved";
    acknowledged: "acknowledged";
    suppressed: "suppressed";
    silenced: "silenced";
    triggered: "triggered";
    escalated: "escalated";
    notified: "notified";
    grouped: "grouped";
    auto_resolved: "auto_resolved";
    rule_modified: "rule_modified";
}>;
export type HistoryAction = z.infer<typeof HistoryActionSchema>;
export declare const IngestEventSchema: z.ZodObject<{
    ruleId: z.ZodOptional<z.ZodString>;
    severity: z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>;
    source: z.ZodString;
    sourceId: z.ZodOptional<z.ZodString>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    labels: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    annotations: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    fingerprint: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type IngestEventBody = z.infer<typeof IngestEventSchema>;
export declare const ListEventsQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    status: z.ZodOptional<z.ZodEnum<{
        error: "error";
        pending: "pending";
        processing: "processing";
        firing: "firing";
        resolved: "resolved";
        acknowledged: "acknowledged";
        suppressed: "suppressed";
        silenced: "silenced";
    }>>;
    severity: z.ZodOptional<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>;
    source: z.ZodOptional<z.ZodString>;
    ruleId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;
export declare const AcknowledgeEventSchema: z.ZodObject<{
    comment: z.ZodOptional<z.ZodString>;
    expiresInMinutes: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type AcknowledgeEventBody = z.infer<typeof AcknowledgeEventSchema>;
export declare const ResolveEventSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
    comment: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ResolveEventBody = z.infer<typeof ResolveEventSchema>;
export interface AlertEventRow {
    id: string;
    organization_id: string;
    rule_id: string | null;
    status: AlertEventStatus;
    severity: AlertSeverity;
    fingerprint: string;
    source: string;
    source_id: string | null;
    payload: Record<string, unknown>;
    payload_size_bytes: number | null;
    normalized_payload: Record<string, unknown> | null;
    group_id: string | null;
    group_key: string | null;
    is_group_parent: boolean;
    parent_event_id: string | null;
    duplicate_count: number;
    started_at: Date;
    ended_at: Date | null;
    last_notified_at: Date | null;
    next_escalation_at: Date | null;
    auto_resolve_at: Date | null;
    acknowledged_by: string | null;
    acknowledged_at: Date | null;
    acknowledgment_expires_at: Date | null;
    resolved_by: string | null;
    resolved_at: Date | null;
    resolution_reason: string | null;
    suppressed_by: string | null;
    suppressed_at: Date | null;
    suppression_reason: string | null;
    labels: Record<string, unknown>;
    annotations: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
}
export interface AlertBatchRow {
    id: string;
    organization_id: string;
    status: BatchStatus;
    event_ids: string[];
    worker_id: string | null;
    pg_boss_job_id: string | null;
    event_count: number;
    success_count: number;
    failure_count: number;
    skipped_count: number;
    started_at: Date | null;
    completed_at: Date | null;
    duration_ms: number | null;
    error_message: string | null;
    error_details: Record<string, unknown>;
    retry_count: number;
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
}
export interface AlertDeliveryAttemptRow {
    id: string;
    organization_id: string;
    event_id: string;
    connector_id: string | null;
    route_id: string | null;
    batch_id: string | null;
    status: DeliveryAttemptStatus;
    request_payload: Record<string, unknown> | null;
    response_payload: string | null;
    response_status_code: number | null;
    error_message: string | null;
    error_category: string | null;
    latency_ms: number | null;
    retry_count: number;
    external_message_id: string | null;
    created_at: Date;
    updated_at: Date;
}
export declare const OrgEventParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    id: z.ZodString;
}, z.core.$strip>;
//# sourceMappingURL=events.types.d.ts.map