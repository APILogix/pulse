/**
 * Alert rule binding persistence (control-plane / primary DB).
 *
 * Architecture: docs/alerting-redesign/02-data-model.md §1
 *               docs/alerting-redesign/adr/0004-rule-inheritance-model.md
 *               docs/alerting-redesign/adr/0006-database-ownership.md
 *
 * ADR-0006: bindings are mutable CONFIGURATION, so they live in the primary database and
 * this repository only ever touches the primary pool. It never imports the Log DB.
 *
 * Every mutation records an `alert_rule_revisions` row and bumps
 * `alert_rules.current_revision` inside the SAME transaction, so version history can never
 * drift from the configuration it describes (audit finding D8).
 */
import type { Pool, PoolClient } from 'pg';
import { pool as primaryPool } from '../../../config/database.js';
import { AlertNotFoundError, AlertConflictError } from '../types.js';
import type { AlertRuleBindingRow, AlertScopeType } from '../policy/resolve-rule.js';
import {
  scopeLevelFor,
  type CreateBindingBody,
  type UpdateBindingBody,
} from './bindings.types.js';

const BINDING_COLUMNS = `
  id, organization_id, rule_id, scope_type, scope_level,
  project_id, environment, service, endpoint,
  mode, enabled, priority,
  severity, cooldown_seconds, deduplication_window_seconds,
  auto_resolve_after_minutes, evaluation_interval_seconds, consecutive_breaches,
  threshold_overrides, action_mode, requested_channels, recipient_overrides,
  escalation_policy_id, notes, created_by, updated_by,
  created_at, updated_at, deleted_at
`;

/**
 * What this repository actually returns.
 *
 * `AlertRuleBindingRow` is deliberately the RESOLVER's contract — only the columns the pure
 * fold reads — so the policy layer cannot accidentally depend on audit metadata. The
 * repository selects the audit columns too, so it describes them here instead of widening
 * the resolver's input type.
 */
export interface AlertRuleBindingRecord extends AlertRuleBindingRow {
  created_by: string | null;
  updated_by: string | null;
  updated_at: Date;
}

export type RevisionChangeKind = 'rule' | 'condition' | 'action' | 'binding';

export interface AlertRuleRevisionRow {
  id: string;
  organization_id: string;
  rule_id: string;
  revision: number;
  change_kind: RevisionChangeKind;
  snapshot: Record<string, unknown>;
  actor_user_id: string | null;
  created_at: Date;
}

/** Postgres unique-violation code. */
const UNIQUE_VIOLATION = '23505';

export class AlertRuleBindingsRepository {
  private readonly db: Pool;

  /** @param db the PRIMARY control-plane pool (ADR-0006). */
  constructor(db: Pool = primaryPool) {
    this.db = db;
  }

  get connectionPool(): Pool {
    return this.db;
  }

  private async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Confirm the rule belongs to the organization before touching its bindings. */
  private async requireRule(
    client: Pool | PoolClient,
    organizationId: string,
    ruleId: string,
  ): Promise<void> {
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM alert_rules
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       ) AS "exists"`,
      [ruleId, organizationId],
    );
    if (!result.rows[0]?.exists) throw new AlertNotFoundError('Alert rule');
  }

  /**
   * Take the rule's write lock as the FIRST statement of a mutating transaction.
   *
   * This is a lock-ORDERING requirement, not just an existence check. Inserting a binding
   * takes an implicit `FOR KEY SHARE` lock on the parent `alert_rules` row (foreign key
   * enforcement). If the exclusive lock needed to allocate a revision were taken
   * afterwards, two concurrent writers on the same rule would each hold KEY SHARE and each
   * wait to upgrade to UPDATE — a lock upgrade deadlock, which PostgreSQL resolves by
   * aborting one transaction. Measured in
   * `test/integration/alerting-bindings-repository.test.ts` ("allocates distinct, gap-free
   * revisions when writes race on the same rule") before this was hoisted.
   *
   * Acquiring UPDATE first makes concurrent writers queue cleanly, which is what
   * guarantees the gap-free revision sequence.
   */
  private async lockRuleForWrite(
    client: PoolClient,
    organizationId: string,
    ruleId: string,
  ): Promise<void> {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM alert_rules
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [ruleId, organizationId],
    );
    if (!result.rows[0]) throw new AlertNotFoundError('Alert rule');
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  async listByRule(organizationId: string, ruleId: string): Promise<AlertRuleBindingRecord[]> {
    await this.requireRule(this.db, organizationId, ruleId);
    const result = await this.db.query<AlertRuleBindingRecord>(
      `SELECT ${BINDING_COLUMNS} FROM alert_rule_bindings
        WHERE organization_id = $1 AND rule_id = $2 AND deleted_at IS NULL
        ORDER BY scope_level ASC, priority DESC, created_at ASC`,
      [organizationId, ruleId],
    );
    return result.rows;
  }

  /**
   * Bulk-load bindings for many rules in ONE query.
   *
   * Effective rule resolution runs per rule; loading bindings per rule would reintroduce
   * the N+1 the architecture is explicit about avoiding.
   */
  async listByRuleIds(
    organizationId: string,
    ruleIds: string[],
  ): Promise<Map<string, AlertRuleBindingRecord[]>> {
    const grouped = new Map<string, AlertRuleBindingRecord[]>();
    if (ruleIds.length === 0) return grouped;

    const result = await this.db.query<AlertRuleBindingRecord>(
      `SELECT ${BINDING_COLUMNS} FROM alert_rule_bindings
        WHERE organization_id = $1 AND rule_id = ANY($2::uuid[]) AND deleted_at IS NULL
        ORDER BY scope_level ASC, priority DESC, created_at ASC`,
      [organizationId, ruleIds],
    );
    for (const row of result.rows) {
      const list = grouped.get(row.rule_id) ?? [];
      list.push(row);
      grouped.set(row.rule_id, list);
    }
    return grouped;
  }

  async findById(
    organizationId: string,
    ruleId: string,
    bindingId: string,
  ): Promise<AlertRuleBindingRecord | null> {
    const result = await this.db.query<AlertRuleBindingRecord>(
      `SELECT ${BINDING_COLUMNS} FROM alert_rule_bindings
        WHERE id = $1 AND rule_id = $2 AND organization_id = $3 AND deleted_at IS NULL`,
      [bindingId, ruleId, organizationId],
    );
    return result.rows[0] ?? null;
  }

  async listRevisions(
    organizationId: string,
    ruleId: string,
    limit = 50,
  ): Promise<AlertRuleRevisionRow[]> {
    const result = await this.db.query<AlertRuleRevisionRow>(
      `SELECT id, organization_id, rule_id, revision, change_kind, snapshot,
              actor_user_id, created_at
         FROM alert_rule_revisions
        WHERE organization_id = $1 AND rule_id = $2
        ORDER BY revision DESC
        LIMIT $3`,
      [organizationId, ruleId, Math.max(1, Math.min(limit, 500))],
    );
    return result.rows;
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    ruleId: string,
    input: CreateBindingBody,
    actorUserId: string | null,
  ): Promise<AlertRuleBindingRecord> {
    return this.withTransaction(async (client) => {
      await this.lockRuleForWrite(client, organizationId, ruleId);

      let row: AlertRuleBindingRecord;
      try {
        const result = await client.query<AlertRuleBindingRecord>(
          `INSERT INTO alert_rule_bindings (
             organization_id, rule_id, scope_type, scope_level,
             project_id, environment, service, endpoint,
             mode, enabled, priority,
             severity, cooldown_seconds, deduplication_window_seconds,
             auto_resolve_after_minutes, evaluation_interval_seconds, consecutive_breaches,
             threshold_overrides, action_mode, requested_channels, recipient_overrides,
             escalation_policy_id, notes, created_by, updated_by
           ) VALUES (
             $1, $2, $3::alert_scope_type, $4,
             $5, $6, $7, $8,
             $9::alert_binding_mode, $10, $11,
             $12, $13, $14,
             $15, $16, $17,
             $18::jsonb, $19::alert_action_merge_mode, $20::jsonb, $21::jsonb,
             $22, $23, $24, $24
           )
           RETURNING ${BINDING_COLUMNS}`,
          [
            organizationId,
            ruleId,
            input.scopeType,
            scopeLevelFor(input.scopeType as AlertScopeType),
            input.projectId ?? null,
            input.environment ?? null,
            input.service ?? null,
            input.endpoint ?? null,
            input.mode,
            input.enabled,
            input.priority,
            input.severity ?? null,
            input.cooldownSeconds ?? null,
            input.deduplicationWindowSeconds ?? null,
            input.autoResolveAfterMinutes ?? null,
            input.evaluationIntervalSeconds ?? null,
            input.consecutiveBreaches ?? null,
            JSON.stringify(input.thresholdOverrides ?? {}),
            input.actionMode,
            input.requestedChannels ? JSON.stringify(input.requestedChannels) : null,
            input.recipientOverrides ? JSON.stringify(input.recipientOverrides) : null,
            input.escalationPolicyId ?? null,
            input.notes ?? null,
            actorUserId,
          ],
        );
        row = result.rows[0]!;
      } catch (err) {
        if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
          throw new AlertConflictError(
            'A binding already exists for this rule at that exact scope',
          );
        }
        throw err;
      }

      await this.recordRevision(client, organizationId, ruleId, 'binding', actorUserId);
      return row;
    });
  }

  async update(
    organizationId: string,
    ruleId: string,
    bindingId: string,
    patch: UpdateBindingBody,
    actorUserId: string | null,
  ): Promise<AlertRuleBindingRecord> {
    const columnFor: Record<keyof UpdateBindingBody, string> = {
      mode: 'mode',
      enabled: 'enabled',
      priority: 'priority',
      severity: 'severity',
      cooldownSeconds: 'cooldown_seconds',
      deduplicationWindowSeconds: 'deduplication_window_seconds',
      autoResolveAfterMinutes: 'auto_resolve_after_minutes',
      evaluationIntervalSeconds: 'evaluation_interval_seconds',
      consecutiveBreaches: 'consecutive_breaches',
      thresholdOverrides: 'threshold_overrides',
      actionMode: 'action_mode',
      requestedChannels: 'requested_channels',
      recipientOverrides: 'recipient_overrides',
      escalationPolicyId: 'escalation_policy_id',
      notes: 'notes',
    };
    const jsonColumns = new Set(['threshold_overrides', 'requested_channels', 'recipient_overrides']);
    const enumCasts: Record<string, string> = {
      mode: '::alert_binding_mode',
      action_mode: '::alert_action_merge_mode',
    };

    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const [key, column] of Object.entries(columnFor) as Array<[keyof UpdateBindingBody, string]>) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      const raw = patch[key];
      values.push(
        raw === null || raw === undefined
          ? null
          : jsonColumns.has(column) ? JSON.stringify(raw) : raw,
      );
      const cast = jsonColumns.has(column) ? '::jsonb' : enumCasts[column] ?? '';
      assignments.push(`${column} = $${values.length}${cast}`);
    }

    return this.withTransaction(async (client) => {
      await this.lockRuleForWrite(client, organizationId, ruleId);

      if (assignments.length === 0) {
        const existing = await client.query<AlertRuleBindingRecord>(
          `SELECT ${BINDING_COLUMNS} FROM alert_rule_bindings
            WHERE id = $1 AND rule_id = $2 AND organization_id = $3 AND deleted_at IS NULL`,
          [bindingId, ruleId, organizationId],
        );
        if (!existing.rows[0]) throw new AlertNotFoundError('Alert rule binding');
        return existing.rows[0];
      }

      values.push(actorUserId, bindingId, ruleId, organizationId);
      const result = await client.query<AlertRuleBindingRecord>(
        `UPDATE alert_rule_bindings
            SET ${assignments.join(', ')}, updated_by = $${values.length - 3}
          WHERE id = $${values.length - 2}
            AND rule_id = $${values.length - 1}
            AND organization_id = $${values.length}
            AND deleted_at IS NULL
          RETURNING ${BINDING_COLUMNS}`,
        values,
      );
      if (!result.rows[0]) throw new AlertNotFoundError('Alert rule binding');

      await this.recordRevision(client, organizationId, ruleId, 'binding', actorUserId);
      return result.rows[0];
    });
  }

  /**
   * Soft delete. The partial unique index only covers live rows, so the same scope can be
   * bound again afterwards.
   */
  async softDelete(
    organizationId: string,
    ruleId: string,
    bindingId: string,
    actorUserId: string | null,
  ): Promise<void> {
    await this.withTransaction(async (client) => {
      await this.lockRuleForWrite(client, organizationId, ruleId);
      const result = await client.query(
        `UPDATE alert_rule_bindings
            SET deleted_at = NOW(), updated_by = $4
          WHERE id = $1 AND rule_id = $2 AND organization_id = $3 AND deleted_at IS NULL`,
        [bindingId, ruleId, organizationId, actorUserId],
      );
      if ((result.rowCount ?? 0) === 0) throw new AlertNotFoundError('Alert rule binding');

      await this.recordRevision(client, organizationId, ruleId, 'binding', actorUserId);
    });
  }

  // ── Revisions ──────────────────────────────────────────────────────────────

  /**
   * Snapshot the whole rule aggregate and bump `alert_rules.current_revision`.
   *
   * The revision number is read under `FOR UPDATE`, so two concurrent config writes cannot
   * allocate the same one. Callers inside this class already hold that lock via
   * `lockRuleForWrite`, where it must be taken to avoid a lock-upgrade deadlock; re-locking
   * here is a no-op in the same transaction and keeps the method safe to call on its own.
   */
  async recordRevision(
    client: PoolClient,
    organizationId: string,
    ruleId: string,
    changeKind: RevisionChangeKind,
    actorUserId: string | null,
  ): Promise<number> {
    const ruleResult = await client.query<{ current_revision: number }>(
      `SELECT current_revision FROM alert_rules
        WHERE id = $1 AND organization_id = $2
        FOR UPDATE`,
      [ruleId, organizationId],
    );
    const current = ruleResult.rows[0];
    if (!current) throw new AlertNotFoundError('Alert rule');
    const nextRevision = current.current_revision + 1;

    const snapshot = await client.query<{ snapshot: Record<string, unknown> }>(
      `SELECT jsonb_build_object(
                'rule', to_jsonb(r) - 'created_at' - 'updated_at',
                'conditions', COALESCE(
                  (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.order_index, c.id)
                     FROM alert_rule_conditions c WHERE c.rule_id = r.id), '[]'::jsonb),
                'actions', COALESCE(
                  (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.order_index, a.id)
                     FROM alert_rule_actions a WHERE a.rule_id = r.id), '[]'::jsonb),
                'bindings', COALESCE(
                  (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.scope_level, b.id)
                     FROM alert_rule_bindings b
                    WHERE b.rule_id = r.id AND b.deleted_at IS NULL), '[]'::jsonb)
              ) AS snapshot
         FROM alert_rules r
        WHERE r.id = $1`,
      [ruleId],
    );

    await client.query(
      `INSERT INTO alert_rule_revisions
         (organization_id, rule_id, revision, change_kind, snapshot, actor_user_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        organizationId,
        ruleId,
        nextRevision,
        changeKind,
        JSON.stringify(snapshot.rows[0]?.snapshot ?? {}),
        actorUserId,
      ],
    );

    await client.query(
      `UPDATE alert_rules SET current_revision = $2, updated_at = NOW() WHERE id = $1`,
      [ruleId, nextRevision],
    );

    return nextRevision;
  }
}
