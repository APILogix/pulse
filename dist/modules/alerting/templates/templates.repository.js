import { pool } from '../../../config/database.js';
import { AlertConflictError, AlertNotFoundError, } from '../types.js';
function pgCode(e) {
    return typeof e === 'object' && e !== null ? e.code : undefined;
}
export class TemplatesRepository {
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
    // ── Templates ────────────────────────────────────────────────────────────
    async createTemplate(input) {
        try {
            const r = await this.db.query(`INSERT INTO alert_templates
           (organization_id, name, template_type, content, variables_schema, default_for_severity, connector_type, is_default, sample_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [
                input.organizationId, input.name, input.templateType, input.content,
                JSON.stringify(input.variablesSchema), input.defaultForSeverity, input.connectorType,
                input.isDefault, JSON.stringify(input.sampleData),
            ]);
            return r.rows[0];
        }
        catch (e) {
            if (pgCode(e) === '23505')
                throw new AlertConflictError('A template with this name already exists');
            throw e;
        }
    }
    async findTemplate(organizationId, id) {
        const r = await this.db.query(`SELECT * FROM alert_templates WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, organizationId]);
        return r.rows[0] ?? null;
    }
    async listTemplates(organizationId, limit, offset) {
        const countRes = await this.db.query(`SELECT COUNT(*)::text AS count FROM alert_templates WHERE organization_id=$1 AND deleted_at IS NULL`, [organizationId]);
        const r = await this.db.query(`SELECT * FROM alert_templates WHERE organization_id=$1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [organizationId, limit, offset]);
        return { data: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    async deleteTemplate(organizationId, id) {
        const r = await this.db.query(`UPDATE alert_templates SET deleted_at=NOW() WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, organizationId]);
        if (r.rowCount === 0)
            throw new AlertNotFoundError('Template');
    }
}
//# sourceMappingURL=templates.repository.js.map