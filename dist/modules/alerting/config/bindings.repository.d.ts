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
import type { AlertRuleBindingRow } from '../policy/resolve-rule.js';
import { type CreateBindingBody, type UpdateBindingBody } from './bindings.types.js';
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
export declare class AlertRuleBindingsRepository {
    private readonly db;
    /** @param db the PRIMARY control-plane pool (ADR-0006). */
    constructor(db?: Pool);
    get connectionPool(): Pool;
    private withTransaction;
    /** Confirm the rule belongs to the organization before touching its bindings. */
    private requireRule;
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
    private lockRuleForWrite;
    listByRule(organizationId: string, ruleId: string): Promise<AlertRuleBindingRecord[]>;
    /**
     * Bulk-load bindings for many rules in ONE query.
     *
     * Effective rule resolution runs per rule; loading bindings per rule would reintroduce
     * the N+1 the architecture is explicit about avoiding.
     */
    listByRuleIds(organizationId: string, ruleIds: string[]): Promise<Map<string, AlertRuleBindingRecord[]>>;
    findById(organizationId: string, ruleId: string, bindingId: string): Promise<AlertRuleBindingRecord | null>;
    listRevisions(organizationId: string, ruleId: string, limit?: number): Promise<AlertRuleRevisionRow[]>;
    create(organizationId: string, ruleId: string, input: CreateBindingBody, actorUserId: string | null): Promise<AlertRuleBindingRecord>;
    update(organizationId: string, ruleId: string, bindingId: string, patch: UpdateBindingBody, actorUserId: string | null): Promise<AlertRuleBindingRecord>;
    /**
     * Soft delete. The partial unique index only covers live rows, so the same scope can be
     * bound again afterwards.
     */
    softDelete(organizationId: string, ruleId: string, bindingId: string, actorUserId: string | null): Promise<void>;
    /**
     * Snapshot the whole rule aggregate and bump `alert_rules.current_revision`.
     *
     * The revision number is read under `FOR UPDATE`, so two concurrent config writes cannot
     * allocate the same one. Callers inside this class already hold that lock via
     * `lockRuleForWrite`, where it must be taken to avoid a lock-upgrade deadlock; re-locking
     * here is a no-op in the same transaction and keeps the method safe to call on its own.
     */
    recordRevision(client: PoolClient, organizationId: string, ruleId: string, changeKind: RevisionChangeKind, actorUserId: string | null): Promise<number>;
}
//# sourceMappingURL=bindings.repository.d.ts.map