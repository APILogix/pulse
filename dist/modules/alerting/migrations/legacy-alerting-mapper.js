import { createHash } from 'node:crypto';
export class LegacyAlertingMapper {
    db;
    constructor(db) {
        this.db = db;
    }
    async record(input, client) {
        const db = client ?? this.db;
        const sourceHash = createHash('sha256')
            .update(JSON.stringify(sortKeys(input.sourcePayload)))
            .digest('hex');
        await db.query(`INSERT INTO alerting_legacy_mappings (
         organization_id, project_id, legacy_source, legacy_source_id,
         canonical_rule_id, canonical_binding_id, source_revision, source_hash,
         mapping_status, mapping_error, checkpoint
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (legacy_source, legacy_source_id) DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         project_id = EXCLUDED.project_id,
         canonical_rule_id = EXCLUDED.canonical_rule_id,
         canonical_binding_id = EXCLUDED.canonical_binding_id,
         source_revision = EXCLUDED.source_revision,
         source_hash = EXCLUDED.source_hash,
         mapping_status = EXCLUDED.mapping_status,
         mapping_error = EXCLUDED.mapping_error,
         checkpoint = EXCLUDED.checkpoint,
         updated_at = NOW()`, [
            input.organizationId,
            input.projectId,
            input.legacySource,
            input.legacySourceId,
            input.canonicalRuleId ?? null,
            input.canonicalBindingId ?? null,
            input.sourceRevision,
            sourceHash,
            input.status ?? 'pending',
            input.error ?? null,
            input.checkpoint ?? null,
        ]);
    }
    async withTransaction(operation) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const result = await operation(client);
            await client.query('COMMIT');
            return result;
        }
        catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        }
        finally {
            client.release();
        }
    }
}
function sortKeys(value) {
    if (Array.isArray(value))
        return value.map(sortKeys);
    if (!value || typeof value !== 'object')
        return value;
    const record = value;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortKeys(record[key])]));
}
//# sourceMappingURL=legacy-alerting-mapper.js.map