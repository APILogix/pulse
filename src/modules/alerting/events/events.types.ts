import { z } from 'zod';
import { UuidSchema, PaginationSchema, AlertSeveritySchema, type AlertSeverity } from '../common.js';
import type { RequestMeta } from '../types.js';


import { AppError } from '../../../shared/errors/app-error.js';

export const AlertEventStatusSchema = z.enum([
  'pending', 'processing', 'firing', 'resolved', 'acknowledged', 'suppressed', 'silenced', 'error',
]);

export type AlertEventStatus = z.infer<typeof AlertEventStatusSchema>;

export const DeliveryAttemptStatusSchema = z.enum([
  'pending', 'queued', 'sent', 'delivered', 'failed', 'retrying', 'cancelled',
]);

export type DeliveryAttemptStatus = z.infer<typeof DeliveryAttemptStatusSchema>;

export const BatchStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'partial']);

export type BatchStatus = z.infer<typeof BatchStatusSchema>;

export const HistoryActionSchema = z.enum([
  'triggered', 'acknowledged', 'resolved', 'escalated', 'suppressed', 'notified',
  'silenced', 'grouped', 'auto_resolved', 'rule_modified',
  'escalation_step', 'throttled', 'dead_lettered', 'requeued',
]);

export type HistoryAction = z.infer<typeof HistoryActionSchema>;

export const DeadLetterStatusSchema = z.enum(['pending_retry', 'retried', 'exhausted', 'discarded']);

export type DeadLetterStatus = z.infer<typeof DeadLetterStatusSchema>;

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

export type IngestEventBody = z.infer<typeof IngestEventSchema>;

export const ListEventsQuerySchema = PaginationSchema.extend({
  status: AlertEventStatusSchema.optional(),
  severity: AlertSeveritySchema.optional(),
  source: z.string().max(100).optional(),
  ruleId: UuidSchema.optional(),
});

export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

export const AcknowledgeEventSchema = z.object({
  comment: z.string().max(2000).optional(),
  expiresInMinutes: z.number().int().min(1).max(20_160).optional(),
});

export type AcknowledgeEventBody = z.infer<typeof AcknowledgeEventSchema>;

export const ResolveEventSchema = z.object({
  reason: z.string().max(100).optional(),
  comment: z.string().max(2000).optional(),
});

export type ResolveEventBody = z.infer<typeof ResolveEventSchema>;

export const ListDeadLettersQuerySchema = PaginationSchema.extend({
  status: DeadLetterStatusSchema.optional(),
});

export type ListDeadLettersQuery = z.infer<typeof ListDeadLettersQuerySchema>;

export interface AlertEventRow {
  id: string;
  organization_id: string;
  rule_id: string | null;
  /** Optional project scope (NULL = org-level event). */
  project_id: string | null;
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
  escalation_policy_id: string | null;
  escalation_step_number: number;
  escalation_repeat_count: number;
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
  processed_count: number;
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

export interface AlertThrottleWindowRow {
  id: string;
  rule_action_id: string;
  window_start: Date;
  notification_count: number;
  last_notified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AlertDeadLetterRow {
  id: string;
  organization_id: string;
  source_queue: string;
  pg_boss_job_id: string | null;
  batch_id: string | null;
  event_ids: string[];
  job_payload: Record<string, unknown>;
  error_message: string | null;
  status: DeadLetterStatus;
  retry_count: number;
  max_retries: number;
  last_retry_at: Date | null;
  retried_at: Date | null;
  discarded_at: Date | null;
  discarded_by: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export const OrgEventParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema });
