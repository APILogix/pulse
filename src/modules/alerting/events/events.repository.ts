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
  type AlertDeadLetterRow,
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
  type AlertThrottleWindowRow,
  type DeadLetterStatus,
  type DeliveryAttemptStatus,
  type ListDeadLettersQuery,
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
  /** Optional project scope (null = org-level event). */
  projectId: string | null;
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
    projectId?: string | null,
  ): Promise<AlertEventRow | null> {
    const r = await this.db.query<AlertEventRow>(
      `SELECT * FROM alert_events
       WHERE organization_id=$1 AND fingerprint=$2
         AND status IN ('firing','acknowledged','pending','processing')
         AND started_at >= NOW() - ($3 || ' seconds')::interval
         AND ($4::uuid IS NULL OR project_id = $4)
       ORDER BY started_at DESC LIMIT 1`,
      [organizationId, fingerprint, String(windowSeconds), projectId ?? null],
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
         (organization_id, rule_id, project_id, status, severity, fingerprint, source, source_id,
          payload, payload_size_bytes, normalized_payload, labels, annotations, auto_resolve_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        input.organizationId, input.ruleId, input.projectId, input.status, input.severity, input.fingerprint,
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
   * is set for events that were delivered (status 'firing'). Escalation columns
   * are only overwritten when the caller provides a non-null value (COALESCE),
   * so non-escalating status changes leave escalation state untouched.
   */
  async bulkUpdateEventStatus(
    organizationId: string,
    updates: Array<{
      id: string;
      status: AlertEventStatus;
      escalationPolicyId?: string | null;
      escalationStepNumber?: number | null;
      nextEscalationAt?: Date | null;
    }>,
  ): Promise<void> {
    if (updates.length === 0) return;
    await this.db.query(
      `UPDATE alert_events e
       SET status = u.status::alert_event_status,
           last_notified_at = CASE WHEN u.status='firing' THEN NOW() ELSE e.last_notified_at END,
           escalation_policy_id = COALESCE(u.escalation_policy_id, e.escalation_policy_id),
           escalation_step_number = COALESCE(u.escalation_step_number, e.escalation_step_number),
           next_escalation_at = COALESCE(u.next_escalation_at, e.next_escalation_at)
       FROM (SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::uuid[], $4::int[], $5::timestamptz[])
             AS t(id, status, escalation_policy_id, escalation_step_number, next_escalation_at)) u
       WHERE e.id = u.id AND e.organization_id = $6`,
      [
        updates.map((u) => u.id),
        updates.map((u) => u.status),
        updates.map((u) => u.escalationPolicyId ?? null),
        updates.map((u) => u.escalationStepNumber ?? null),
        updates.map((u) => u.nextEscalationAt ?? null),
        organizationId,
      ],
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

  // ── Escalation execution sweeps ──────────────────────────────────────────
  /**
   * Claim firing events whose next escalation step is due. SKIP LOCKED makes
   * concurrent sweep workers safe — no two workers process the same event.
   */
  async claimEscalationDue(limit: number): Promise<AlertEventRow[]> {
    return this.withTransaction(async (client) => {
      const r = await client.query<AlertEventRow>(
        `SELECT * FROM alert_events
         WHERE status='firing'
           AND escalation_policy_id IS NOT NULL
           AND next_escalation_at IS NOT NULL
           AND next_escalation_at <= NOW()
         ORDER BY next_escalation_at ASC LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      return r.rows;
    });
  }

  /** Advance an event to a given escalation step and schedule the next run (or stop). */
  async advanceEscalation(
    eventId: string,
    stepNumber: number,
    repeatCount: number,
    nextEscalationAt: Date | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE alert_events
       SET escalation_step_number=$2, escalation_repeat_count=$3, next_escalation_at=$4
       WHERE id=$1 AND status='firing'`,
      [eventId, stepNumber, repeatCount, nextEscalationAt],
    );
  }

  /**
   * Flip expired acknowledgments back to firing so escalation resumes.
   * Returns the affected rows (already locked + transitioned in one statement).
   */
  async resumeExpiredAcknowledgments(limit: number): Promise<AlertEventRow[]> {
    const r = await this.db.query<AlertEventRow>(
      `UPDATE alert_events
       SET status='firing', acknowledged_by=NULL, acknowledged_at=NULL,
           acknowledgment_expires_at=NULL,
           next_escalation_at = CASE WHEN escalation_policy_id IS NOT NULL THEN NOW() ELSE NULL END
       WHERE id IN (
         SELECT id FROM alert_events
         WHERE status='acknowledged'
           AND acknowledgment_expires_at IS NOT NULL
           AND acknowledgment_expires_at <= NOW()
         ORDER BY acknowledgment_expires_at ASC LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [limit],
    );
    return r.rows;
  }

  // ── Orphan (stuck processing) recovery ───────────────────────────────────
  /**
   * Requeue events stuck in 'processing' for longer than `staleMinutes`
   * (worker crash or pg-boss job expiry) back to 'pending'. SKIP LOCKED on the
   * claim; the UPDATE is idempotent because it only touches rows still in
   * 'processing'.
   */
  async requeueStuckProcessingEvents(staleMinutes: number, limit: number): Promise<AlertEventRow[]> {
    const r = await this.db.query<AlertEventRow>(
      `UPDATE alert_events
       SET status='pending'
       WHERE id IN (
         SELECT id FROM alert_events
         WHERE status='processing' AND updated_at < NOW() - ($1 || ' minutes')::interval
         ORDER BY updated_at ASC LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [String(staleMinutes), limit],
    );
    return r.rows;
  }

  /** Fail batches stuck in 'processing' for longer than `staleMinutes`. */
  async failStaleBatches(staleMinutes: number): Promise<number> {
    const r = await this.db.query(
      `UPDATE alert_event_batches
       SET status='failed', completed_at=NOW(), error_message='orphaned: worker lost the job',
           retry_count = retry_count + 1
       WHERE status='processing' AND started_at < NOW() - ($1 || ' minutes')::interval`,
      [String(staleMinutes)],
    );
    return r.rowCount ?? 0;
  }

  async setBatchJobId(batchId: string, jobId: string | null): Promise<void> {
    await this.db.query(
      `UPDATE alert_event_batches SET pg_boss_job_id=$2 WHERE id=$1`,
      [batchId, jobId],
    );
  }

  // ── Throttle windows ─────────────────────────────────────────────────────
  /** Fetch current-hour throttle windows for the given rule actions (one query). */
  async getThrottleStates(actionIds: string[]): Promise<AlertThrottleWindowRow[]> {
    if (actionIds.length === 0) return [];
    const r = await this.db.query<AlertThrottleWindowRow>(
      `SELECT * FROM alert_throttle_windows
       WHERE rule_action_id = ANY($1::uuid[])
         AND window_start = date_trunc('hour', NOW())`,
      [actionIds],
    );
    return r.rows;
  }

  /** Increment the current-hour window for each action (bulk upsert). */
  async recordThrottleNotifications(actionIds: string[]): Promise<void> {
    if (actionIds.length === 0) return;
    await this.db.query(
      `INSERT INTO alert_throttle_windows (rule_action_id, window_start, notification_count, last_notified_at)
       SELECT t.action_id, date_trunc('hour', NOW()), 1, NOW()
       FROM UNNEST($1::uuid[]) AS t(action_id)
       ON CONFLICT (rule_action_id, window_start) DO UPDATE SET
         notification_count = alert_throttle_windows.notification_count + 1,
         last_notified_at = NOW()`,
      [actionIds],
    );
  }

  // ── Dead-letter events ───────────────────────────────────────────────────
  async insertDeadLetter(input: {
    organizationId: string;
    sourceQueue: string;
    pgBossJobId: string | null;
    batchId: string | null;
    eventIds: string[];
    jobPayload: Record<string, unknown>;
    errorMessage: string | null;
    maxRetries: number;
  }): Promise<AlertDeadLetterRow> {
    const r = await this.db.query<AlertDeadLetterRow>(
      `INSERT INTO alert_dead_letter_events
         (organization_id, source_queue, pg_boss_job_id, batch_id, event_ids,
          job_payload, error_message, max_retries)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        input.organizationId, input.sourceQueue, input.pgBossJobId, input.batchId,
        input.eventIds, JSON.stringify(input.jobPayload), input.errorMessage, input.maxRetries,
      ],
    );
    return r.rows[0]!;
  }

  async listDeadLetters(
    organizationId: string,
    query: ListDeadLettersQuery,
  ): Promise<{ data: AlertDeadLetterRow[]; total: number }> {
    const conditions = ['organization_id=$1'];
    const params: unknown[] = [organizationId];
    if (query.status) { params.push(query.status); conditions.push(`status=$${params.length}`); }
    const where = conditions.join(' AND ');

    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM alert_dead_letter_events WHERE ${where}`, params,
    );
    params.push(query.limit, query.offset);
    const r = await this.db.query<AlertDeadLetterRow>(
      `SELECT * FROM alert_dead_letter_events WHERE ${where}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { data: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  async findDeadLetterById(organizationId: string, id: string): Promise<AlertDeadLetterRow | null> {
    const r = await this.db.query<AlertDeadLetterRow>(
      `SELECT * FROM alert_dead_letter_events WHERE id=$1 AND organization_id=$2`, [id, organizationId],
    );
    return r.rows[0] ?? null;
  }

  /** Retryable dead letters for the scheduled retry sweep (SKIP LOCKED claim). */
  async claimRetryableDeadLetters(limit: number): Promise<AlertDeadLetterRow[]> {
    return this.withTransaction(async (client) => {
      const r = await client.query<AlertDeadLetterRow>(
        `SELECT * FROM alert_dead_letter_events
         WHERE status='pending_retry' AND retry_count < max_retries
         ORDER BY created_at ASC LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      return r.rows;
    });
  }

  async markDeadLetterRetried(id: string): Promise<void> {
    await this.db.query(
      `UPDATE alert_dead_letter_events
       SET status='retried', retry_count = retry_count + 1, last_retry_at=NOW(), retried_at=NOW()
       WHERE id=$1`,
      [id],
    );
  }

  async markDeadLetterExhausted(id: string): Promise<void> {
    await this.db.query(
      `UPDATE alert_dead_letter_events SET status='exhausted', retry_count = retry_count + 1, last_retry_at=NOW()
       WHERE id=$1`,
      [id],
    );
  }

  async discardDeadLetter(organizationId: string, id: string, userId: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE alert_dead_letter_events
       SET status='discarded', discarded_at=NOW(), discarded_by=$3
       WHERE id=$1 AND organization_id=$2 AND status IN ('pending_retry','exhausted')`,
      [id, organizationId, userId],
    );
    if (r.rowCount === 0) throw new AlertNotFoundError('Dead-letter event');
  }

  // ── Cleanup / retention ──────────────────────────────────────────────────
  /** Purge resolved/suppressed/silenced events older than `days` (history + deliveries cascade). */
  async purgeOldTerminalEvents(days: number): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM alert_events
       WHERE status IN ('resolved','suppressed','silenced')
         AND COALESCE(ended_at, updated_at) < NOW() - ($1 || ' days')::interval`,
      [String(days)],
    );
    return r.rowCount ?? 0;
  }

  async purgeOldBatches(days: number): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM alert_event_batches
       WHERE status IN ('completed','failed','partial')
         AND completed_at < NOW() - ($1 || ' days')::interval`,
      [String(days)],
    );
    return r.rowCount ?? 0;
  }

  async purgeOldDeliveryAttempts(days: number): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM alert_delivery_attempts
       WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(days)],
    );
    return r.rowCount ?? 0;
  }

  async purgeOldDeadLetters(days: number): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM alert_dead_letter_events
       WHERE status IN ('retried','discarded') AND updated_at < NOW() - ($1 || ' days')::interval`,
      [String(days)],
    );
    return r.rowCount ?? 0;
  }

  async purgeOldThrottleWindows(): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM alert_throttle_windows WHERE window_start < NOW() - INTERVAL '2 days'`,
    );
    return r.rowCount ?? 0;
  }

  // ── Silences ─────────────────────────────────────────────────────────────
  // ── Escalation policies + steps ──────────────────────────────────────────
  // ── Templates ────────────────────────────────────────────────────────────
  // ── Routing rules ──────────────────────────────────────────────────────
  // ── Metrics + stats ──────────────────────────────────────────────────────
}
