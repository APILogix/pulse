export class ErrorGroupHistoryRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async insertHistory(client, params) {
        await client.query(`INSERT INTO error_group_history (
         group_id, action, previous_status, new_status, actor_id, actor_type,
         event_id, release, occurred_at, reason, source_group_id, target_group_id,
         old_value, new_value, metadata, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())`, [
            params.groupId,
            params.action,
            params.previousStatus ?? null,
            params.newStatus ?? null,
            params.actorId ?? null,
            params.actorType ?? (params.actorId ? 'user' : 'system'),
            params.eventId ?? null,
            params.release ?? null,
            params.occurredAt ?? null,
            params.reason ?? null,
            params.sourceGroupId ?? null,
            params.targetGroupId ?? null,
            params.oldValue ? JSON.stringify(params.oldValue) : null,
            params.newValue ? JSON.stringify(params.newValue) : null,
            params.metadata ? JSON.stringify(params.metadata) : null,
        ]);
    }
}
//# sourceMappingURL=error-group-history.repository.js.map