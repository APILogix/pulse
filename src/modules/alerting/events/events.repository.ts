/**
 * Alerting persistence layer.
 *
 * Owns all SQL for the alerting module. Tenant isolation is enforced in the
 * service layer by always passing `organization_id` into queries (this
 * codebase isolates tenants in the application layer — see migration 003).
 *
 * Performance contract for the batch worker:
 *   - `getBatchWithEvents` fetches a batch + its events in ONE query.
 *   - `bulkUpdateEventStatus` / `bulkInsertDeliveryAttempts` use UNNEST-based
 *     set operations — NO per-row (N+1) writes.
 */
import type { PoolClient } from 'pg';
import { pool } from '../../../config/database.js';
import {
  AlertConflictError,
  AlertNotFoundError,
  type AlertBatchRow,
  type AlertDeliveryAttemptRow,
  type AlertEscalationPolicyRow,
  type AlertEscalationStepRow,
  type AlertEventRow,
  type AlertEventStatus,
  type AlertMetricRow,
  type AlertRoutingRuleRow,
  type AlertRuleActionRow,
  type AlertRuleConditionRow,
  type AlertRuleRow,
  type AlertSilenceRow,
  type AlertTemplateRow,
  type DeliveryAttemptStatus,
  type ListEventsQuery,
  type ListRulesQuery,
  type MetricGranularity,
} from '../types.js';

function pgCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
}

export interface InsertEventInput {
  organizationId: string;
  ruleId: string | null;
  status: AlertEventStatus;
  severity: string;
  fingerprint: string;
  source: string;
  sourceId: string | null;
  payload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown> | null;
  labels: Record<string, unknown>;
  annotations: Record<string, unknown>;
  autoResolveAt: Date | null;
}

export interface DeliveryAttemptInsert {
  organizationId: string;
  eventId: string;
  connectorId: string | null;
  routeId: string | null;
  batchId: string | null;
  status: DeliveryAttemptStatus;
  responseStatusCode: number | null;
  errorMessage: string | null;
  errorCategory: string | null;
  latencyMs: number | null;
  externalMessageId: string | null;
}

export class EventsRepository {
  private readonly db = pool;

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // ── Rules ──────────────────────────────────────────────────────────────
  // ── Events: ingestion + deduplication ────────────────────────────────────
  /** Find an active (firing/acknowledged) event matching a fingerprint within the dedup window. */
  async findActiveEventByFingerprint(
    organizationId: string,
    fingerprint: string,
    windowSeconds: number,
  ): Promise<AlertEventRow | null> {
    const r = await this.db.query<AlertEventRow>(
      `SELECT * FROM alert_events
       WHERE organization_id=$1 AND fingerprint=$2
         AND status IN ('firing','acknowledged','pending','processing')
         AND started_at >= NOW() - ($3 || ' seconds')::interval
       ORDER BY started_at DESC LIMIT 1`,
      [organizationId, fingerprint, String(windowSeconds)],
    );
    return r.rows[0] ?? null;
  }

  async incrementDuplicate(eventId: string): Promise<AlertEventRow> {
    const r = await this.db.query<AlertEventRow>(
      `UPDATE alert_events SET duplicate_count = duplicate_count + 1 WHERE id=$1 RETURNING *`,
      [eventId],
    );
    if (!r.rows[0]) throw new AlertNotFoundError('Alert event');
    return r.rows[0];
  }

  async insertEvent(input: InsertEventInput): Promise<AlertEventRow> {
    const payloadJson = JSON.stringify(input.payload);
    const r = await this.db.query<AlertEventRow>(
      `INSERT INTO alert_events
         (organization_id, rule_id, status, severity, fingerprint, source, source_id,
          payload, payload_size_bytes, normalized_payload, labels, annotations, auto_resolve_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        input.organizationId, input.ruleId, input.status, input.severity, input.fingerprint,
        input.source, input.sourceId, payloadJson, Buffer.byteLength(payloadJson, 'utf8'),
        input.normalizedPayload ? JSON.stringify(input.normalizedPayload) : null,
        JSON.stringify(input.labels), JSON.stringify(input.annotations), input.autoResolveAt,
      ],
    );
    return r.rows[0]!;
  }

  async findEventById(organizationId: string, id: string): Promise<AlertEventRow | null> {
    const r = await this.db.query<AlertEventRow>(
      `SELECT * FROM alert_events WHERE id=$1 AND organization_id=$2`, [id, organizationId],
    );
    return r.rows[0] ?? null;
  }

  async listEvents(organizationId: string, query: ListEventsQuery): Promise<{ data: AlertEventRow[]; total: number }> {
    const conditions = ['organization_id=$1'];
    const params: unknown[] = [organizationId];
    if (query.status) { params.push(query.status); conditions.push(`status=$${params.length}`); }
    if (query.severity) { params.push(query.severity); conditions.push(`severity=$${params.length}`); }
    if (query.source) { params.push(query.source); conditions.push(`source=$${params.length}`); }
    if (query.ruleId) { params.push(query.ruleId); conditions.push(`rule_id=$${params.length}`); }
    const where = conditions.join(' AND ');

    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM alert_events WHERE ${where}`, params,
    );
    params.push(query.limit, query.offset);
    const r = await this.db.query<AlertEventRow>(
      `SELECT * FROM alert_events WHERE ${where}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { data: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  async acknowledgeEvent(
    organizationId: string, eventId: string, userId: string, expiresAt: Date | null, comment: string | null,
  ): Promise<AlertEventRow> {
    return this.withTransaction(async (client) => {
      const r = await client.query<AlertEventRow>(
        `UPDATE alert_events
         SET status='acknowledged', acknowledged_by=$3, acknowledged_at=NOW(),
             acknowledgment_expires_at=$4, next_escalation_at=NULL
         WHERE id=$1 AND organization_id=$2 AND status IN ('firing','pending','processing')
         RETURNING *`,
        [eventId, organizationId, userId, expiresAt],
      );
      if (!r.rows[0]) throw new AlertNotFoundError('Active alert event');
      // Deactivate any prior active ack, then insert the new one (partial unique idx).
      await client.query(
        `UPDATE alert_acknowledgments SET is_active=false WHERE event_id=$1 AND is_active=true`, [eventId],
      );
      await client.query(
        `INSERT INTO alert_acknowledgments (event_id, organization_id, acknowledged_by, expires_at, comment)
         VALUES ($1,$2,$3,$4,$5)`,
        [eventId, organizationId, userId, expiresAt, comment],
      );
      return r.rows[0];
    });
  }

  async resolveEvent(
    organizationId: string, eventId: string, userId: string | null, reason: string, autoResolved: boolean,
  ): Promise<AlertEventRow> {
    const r = await this.db.query<AlertEventRow>(
      `UPDATE alert_events
       SET status='resolved', resolved_by=$3, resolved_at=NOW(), ended_at=NOW(),
           resolution_reason=$4, next_escalation_at=NULL, auto_resolve_at=NULL
       WHERE id=$1 AND organization_id=$2 AND status NOT IN ('resolved')
       RETURNING *`,
      [eventId, organizationId, userId, reason.slice(0, 100)],
    );
    if (!r.rows[0]) throw new AlertNotFoundError('Unresolved alert event');
    return r.rows[0];
  }

  async insertHistory(input: {
    eventId: string; organizationId: string; action: string; actorId: string | null;
    actorType?: string; previousState?: Record<string, unknown> | null; newState?: Record<string, unknown> | null;
    changesSummary?: Record<string, unknown> | null; metadata?: Record<string, unknown>;
  }, client?: PoolClient): Promise<void> {
    const db = client ?? this.db;
    await db.query(
      `INSERT INTO alert_event_history
         (event_id, organization_id, action, actor_id, actor_type, previous_state, new_state, changes_summary, metadata)
       VALUES ($1,$2,$3::history_action,$4,$5,$6,$7,$8,$9)`,
      [
        input.eventId, input.organizationId, input.action, input.actorId, input.actorType ?? 'user',
        input.previousState ? JSON.stringify(input.previousState) : null,
        input.newState ? JSON.stringify(input.newState) : null,
        input.changesSummary ? JSON.stringify(input.changesSummary) : null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async getEventHistory(eventId: string): Promise<Array<Record<string, unknown>>> {
    const r = await this.db.query(
      `SELECT id, action, actor_id, actor_type, previous_state, new_state, changes_summary, metadata, created_at
       FROM alert_event_history WHERE event_id=$1 ORDER BY created_at ASC`,
      [eventId],
    );
    return r.rows as Array<Record<string, unknown>>;
  }

  async getEventDeliveries(eventId: string): Promise<AlertDeliveryAttemptRow[]> {
    const r = await this.db.query<AlertDeliveryAttemptRow>(
      `SELECT * FROM alert_delivery_attempts WHERE event_id=$1 ORDER BY created_at DESC`, [eventId],
    );
    return r.rows;
  }

  // ── Batch lifecycle ──────────────────────────────────────────────────────
  /**
   * Atomically claim up to `limit` pending events for the org and enqueue them
   * as a single batch. SKIP LOCKED makes concurrent batch creation safe.
   */
  async createBatchFromPending(organizationId: string, limit: number, workerId: string): Promise<AlertBatchRow | null> {
    return this.withTransaction(async (client) => {
      const claimed = await client.query<{ id: string }>(
        `SELECT id FROM alert_events
         WHERE organization_id=$1 AND status='pending'
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [organizationId, limit],
      );
      const ids = claimed.rows.map((r) => r.id);
      if (ids.length === 0) return null;

      await client.query(
        `UPDATE alert_events SET status='processing' WHERE id = ANY($1::uuid[])`, [ids],
      );
      const batch = await client.query<AlertBatchRow>(
        `INSERT INTO alert_event_batches (organization_id, status, event_ids, event_count, worker_id, started_at)
         VALUES ($1,'processing',$2,$3,$4,NOW()) RETURNING *`,
        [organizationId, ids, ids.length, workerId],
      );
      return batch.rows[0]!;
    });
  }

  /** Fetch a batch and ALL its events in a single round-trip (no N+1). */
  async getBatchWithEvents(
    batchId: string, organizationId: string,
  ): Promise<{ batch: AlertBatchRow; events: AlertEventRow[] } | null> {
    const batchRes = await this.db.query<AlertBatchRow>(
      `SELECT * FROM alert_event_batches WHERE id=$1 AND organization_id=$2`, [batchId, organizationId],
    );
    const batch = batchRes.rows[0];
    if (!batch) return null;

    const eventsRes = await this.db.query<AlertEventRow>(
      `SELECT * FROM alert_events WHERE id = ANY($1::uuid[]) AND organization_id=$2`,
      [batch.event_ids, organizationId],
    );
    return { batch, events: eventsRes.rows };
  }

  async completeBatch(
    batchId: string,
    counts: { success: number; failure: number; skipped: number },
    durationMs: number,
    status: 'completed' | 'partial' | 'failed',
    errorMessage: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE alert_event_batches
       SET status=$2, success_count=$3, failure_count=$4, skipped_count=$5,
           duration_ms=$6, completed_at=NOW(), error_message=$7
       WHERE id=$1`,
      [batchId, status, counts.success, counts.failure, counts.skipped, durationMs, errorMessage],
    );
  }

  /**
   * Bulk-update event statuses in ONE statement via UNNEST. `last_notified_at`
   * is set for events that were delivered (status 'firing').
   */
  async bulkUpdateEventStatus(
    organizationId: string,
    updates: Array<{ id: string; status: AlertEventStatus }>,
  ): Promise<void> {
    if (updates.length === 0) return;
    await this.db.query(
      `UPDATE alert_events e
       SET status = u.status::alert_event_status,
           last_notified_at = CASE WHEN u.status='firing' THEN NOW() ELSE e.last_notified_at END
       FROM (SELECT * FROM UNNEST($1::uuid[], $2::text[]) AS t(id, status)) u
       WHERE e.id = u.id AND e.organization_id = $3`,
      [updates.map((u) => u.id), updates.map((u) => u.status), organizationId],
    );
  }

  /** Bulk-insert delivery attempts in ONE statement via UNNEST. */
  async bulkInsertDeliveryAttempts(rows: DeliveryAttemptInsert[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.query(
      `INSERT INTO alert_delivery_attempts
         (organization_id, event_id, connector_id, route_id, batch_id, status,
          response_status_code, error_message, error_category, latency_ms, external_message_id)
       SELECT t.organization_id, t.event_id, t.connector_id, t.route_id, t.batch_id,
              t.status::delivery_attempt_status, t.response_status_code, t.error_message,
              t.error_category, t.latency_ms, t.external_message_id
       FROM UNNEST(
         $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[], $6::text[],
         $7::int[], $8::text[], $9::text[], $10::int[], $11::text[]
       ) AS t(organization_id, event_id, connector_id, route_id, batch_id, status,
              response_status_code, error_message, error_category, latency_ms, external_message_id)`,
      [
        rows.map((r) => r.organizationId),
        rows.map((r) => r.eventId),
        rows.map((r) => r.connectorId),
        rows.map((r) => r.routeId),
        rows.map((r) => r.batchId),
        rows.map((r) => r.status),
        rows.map((r) => r.responseStatusCode),
        rows.map((r) => r.errorMessage),
        rows.map((r) => r.errorCategory),
        rows.map((r) => r.latencyMs),
        rows.map((r) => r.externalMessageId),
      ],
    );
  }

  // ── Auto-resolve + escalation sweeps ─────────────────────────────────────
  /** Distinct org ids that currently have pending (un-batched) events. */
  async findOrgsWithPendingEvents(limit: number): Promise<string[]> {
    const r = await this.db.query<{ organization_id: string }>(
      `SELECT DISTINCT organization_id FROM alert_events WHERE status='pending' LIMIT $1`,
      [limit],
    );
    return r.rows.map((row) => row.organization_id);
  }

  async claimAutoResolvable(limit: number): Promise<AlertEventRow[]> {
    return this.withTransaction(async (client) => {
      const r = await client.query<AlertEventRow>(
        `SELECT * FROM alert_events
         WHERE status='firing' AND auto_resolve_at IS NOT NULL AND auto_resolve_at <= NOW()
         ORDER BY auto_resolve_at ASC LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      return r.rows;
    });
  }

  // ── Silences ─────────────────────────────────────────────────────────────
  // ── Escalation policies + steps ──────────────────────────────────────────
  // ── Templates ────────────────────────────────────────────────────────────
  // ── Routing rules ──────────────────────────────────────────────────────
  // ── Metrics + stats ──────────────────────────────────────────────────────
}
