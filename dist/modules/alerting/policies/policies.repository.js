import { pool } from '../../../config/database.js';
import { AlertConflictError, AlertNotFoundError, } from '../types.js';
function pgCode(e) {
    return typeof e === 'object' && e !== null ? e.code : undefined;
}
export class PoliciesRepository {
    db = pool;
    async withTransaction(fn) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    // ── Rules ──────────────────────────────────────────────────────────────
    // ── Events: ingestion + deduplication ────────────────────────────────────
    // ── Batch lifecycle ──────────────────────────────────────────────────────
    // ── Auto-resolve + escalation sweeps ─────────────────────────────────────
    // ── Silences ─────────────────────────────────────────────────────────────
    // ── Escalation policies + steps ──────────────────────────────────────────
    async createEscalationPolicy(input) {
        try {
            const r = await this.db.query(`INSERT INTO alert_escalation_policies (organization_id, name, description, repeat_interval_minutes, max_repeats, is_active)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [input.organizationId, input.name, input.description, input.repeatIntervalMinutes, input.maxRepeats, input.isActive]);
            return r.rows[0];
        }
        catch (e) {
            if (pgCode(e) === '23505')
                throw new AlertConflictError('An escalation policy with this name already exists');
            throw e;
        }
    }
    async listEscalationPolicies(organizationId, limit, offset) {
        const countRes = await this.db.query(`SELECT COUNT(*)::text AS count FROM alert_escalation_policies WHERE organization_id=$1 AND deleted_at IS NULL`, [organizationId]);
        const r = await this.db.query(`SELECT * FROM alert_escalation_policies WHERE organization_id=$1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [organizationId, limit, offset]);
        return { data: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    async findEscalationPolicy(organizationId, id) {
        const r = await this.db.query(`SELECT * FROM alert_escalation_policies WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, organizationId]);
        return r.rows[0] ?? null;
    }
    async deleteEscalationPolicy(organizationId, id) {
        const r = await this.db.query(`UPDATE alert_escalation_policies SET deleted_at=NOW(), is_active=false WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, organizationId]);
        if (r.rowCount === 0)
            throw new AlertNotFoundError('Escalation policy');
    }
    async upsertEscalationStep(policyId, input) {
        const r = await this.db.query(`INSERT INTO alert_escalation_steps
         (policy_id, step_number, wait_minutes, connector_ids, route_ids, notify_on_call, custom_message_template, template_id, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (policy_id, step_number) DO UPDATE SET
         wait_minutes=EXCLUDED.wait_minutes, connector_ids=EXCLUDED.connector_ids,
         route_ids=EXCLUDED.route_ids, notify_on_call=EXCLUDED.notify_on_call,
         custom_message_template=EXCLUDED.custom_message_template, template_id=EXCLUDED.template_id,
         is_active=EXCLUDED.is_active, updated_at=NOW()
       RETURNING *`, [policyId, input.stepNumber, input.waitMinutes, input.connectorIds, input.routeIds,
            input.notifyOnCall, input.customMessageTemplate, input.templateId, input.isActive]);
        return r.rows[0];
    }
    async listEscalationSteps(policyId) {
        const r = await this.db.query(`SELECT * FROM alert_escalation_steps WHERE policy_id=$1 ORDER BY step_number ASC`, [policyId]);
        return r.rows;
    }
}
//# sourceMappingURL=policies.repository.js.map