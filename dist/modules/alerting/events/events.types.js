import { z } from 'zod';
import { UuidSchema, PaginationSchema, AlertSeveritySchema } from '../common.js';
import { AppError } from '../../../shared/errors/app-error.js';
export const AlertEventStatusSchema = z.enum([
    'pending', 'processing', 'firing', 'resolved', 'acknowledged', 'suppressed', 'silenced', 'error',
]);
export const DeliveryAttemptStatusSchema = z.enum([
    'pending', 'queued', 'sent', 'delivered', 'failed', 'retrying', 'cancelled',
]);
export const BatchStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'partial']);
export const HistoryActionSchema = z.enum([
    'triggered', 'acknowledged', 'resolved', 'escalated', 'suppressed', 'notified',
    'silenced', 'grouped', 'auto_resolved', 'rule_modified',
    'escalation_step', 'throttled', 'dead_lettered', 'requeued',
]);
export const DeadLetterStatusSchema = z.enum(['pending_retry', 'retried', 'exhausted', 'discarded']);
export const IngestEventSchema = z.object({
    ruleId: UuidSchema.optional(),
    projectId: UuidSchema.optional(),
    severity: AlertSeveritySchema,
    source: z.string().min(1).max(100),
    sourceId: z.string().max(255).optional(),
    payload: z.record(z.string(), z.unknown()),
    labels: z.record(z.string(), z.unknown()).default({}),
    annotations: z.record(z.string(), z.unknown()).default({}),
    fingerprint: z.string().max(255).optional(),
});
export const ListEventsQuerySchema = PaginationSchema.extend({
    status: AlertEventStatusSchema.optional(),
    severity: AlertSeveritySchema.optional(),
    source: z.string().max(100).optional(),
    ruleId: UuidSchema.optional(),
});
export const AcknowledgeEventSchema = z.object({
    comment: z.string().max(2000).optional(),
    expiresInMinutes: z.number().int().min(1).max(20_160).optional(),
});
export const ResolveEventSchema = z.object({
    reason: z.string().max(100).optional(),
    comment: z.string().max(2000).optional(),
});
export const ListDeadLettersQuerySchema = PaginationSchema.extend({
    status: DeadLetterStatusSchema.optional(),
});
export const OrgEventParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema });
//# sourceMappingURL=events.types.js.map