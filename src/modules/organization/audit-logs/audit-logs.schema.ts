import { z } from "zod";
import { CursorPaginationSchema, UuidSchema } from "../shared/types.js";

export const AuditLogQuerySchema = CursorPaginationSchema.extend({
  action: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
  actorUserId: UuidSchema.optional(),
});

export interface CreateAuditLogRecord {
  orgId: string;
  actorUserId: string | null;
  actorEmail?: string;
  actorIp?: string;
  actorUserAgent?: string | null;
  actorSessionId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  entityName?: string;
  requestId?: string;
  correlationId?: string;
  httpMethod?: string;
  endpoint?: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  changedFields?: string[];
  status?: "success" | "failure";
  failureReason?: string;
  isSensitive?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AuditLogRow {
  id: string;
  org_id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  changed_fields: string[] | null;
  status: string;
  is_sensitive: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
}
