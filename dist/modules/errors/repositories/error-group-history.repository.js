export class ErrorGroupHistoryRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async insertHistory(client, params) {
        const { groupId, action, oldValue, newValue, actorId, metadata } = params;
        await client.query(`INSERT INTO error_group_history (group_id, action, old_value, new_value, actor_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`, [
            groupId,
            action,
            oldValue ? JSON.stringify(oldValue) : null,
            newValue ? JSON.stringify(newValue) : null,
            actorId || null,
            metadata ? JSON.stringify(metadata) : null,
        ]);
    }
}
//# sourceMappingURL=error-group-history.repository.js.map