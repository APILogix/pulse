export class AlertUsageRecorder {
    db;
    constructor(db) {
        this.db = db;
    }
    async record(fact, client) {
        const db = client ?? this.db;
        const result = await db.query(`WITH reserved AS (
         INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
         VALUES ('usage_fact', $1, $4)
         ON CONFLICT DO NOTHING
         RETURNING organization_id, idempotency_key
       )
       INSERT INTO alert_usage_facts
         (organization_id, project_id, usage_kind, idempotency_key, quantity, metadata)
       SELECT $1, $2, $3::alert_usage_kind, $4, $5, $6::jsonb
         FROM reserved
       ON CONFLICT DO NOTHING`, [fact.organizationId, fact.projectId ?? null, fact.usageKind, fact.idempotencyKey, fact.quantity ?? 1, JSON.stringify(fact.metadata ?? {})]);
        return (result.rowCount ?? 0) > 0;
    }
}
//# sourceMappingURL=usage.recorder.js.map