import { logDB } from '../../config/log-database.js';
/** Columns that may be used as a correlation key. Fixed allow-list. */
export const CORRELATION_COLUMNS = [
    'trace_id',
    'request_id',
    'span_id',
    'parent_span_id',
    'session_id',
    'user_id',
];
export class ObservabilityRepository {
    /** Execute engine-generated SQL on the read path. */
    async run(sql, params) {
        const result = await logDB.queryWithRetry(sql, params, { operation: 'read' });
        return result.rows;
    }
    /**
     * Fetch rows of a resource correlated by a fixed key column within the
     * tenant + time window. The column is validated against
     * {@link CORRELATION_COLUMNS}; every value is bound as a parameter.
     */
    async fetchCorrelated(input) {
        if (!CORRELATION_COLUMNS.includes(input.column)) {
            throw new Error(`Illegal correlation column: ${input.column}`);
        }
        const { resource, ctx } = input;
        const params = [ctx.organizationId, input.value, input.from, input.to];
        let sql = `SELECT * FROM ${resource.table}
               WHERE organization_id = $1 AND ${input.column} = $2
               AND ${resource.timeColumn} >= $3 AND ${resource.timeColumn} < $4`;
        const projectId = ctx.projectId;
        if (projectId) {
            params.push(projectId);
            sql += ` AND project_id = $${params.length}`;
        }
        if (input.excludeId) {
            params.push(input.excludeId);
            sql += ` AND ${resource.idColumn} <> $${params.length}`;
        }
        params.push(input.limit);
        sql += ` ORDER BY ${resource.timeColumn} ASC LIMIT $${params.length}`;
        const rows = await this.run(sql, params);
        return rows.map((row) => resource.mapRow(row));
    }
    /**
     * Fetch a single row by id, returning the raw row (all columns) so detail
     * assembly can read correlation keys the projection would omit.
     */
    async fetchRawById(resource, ctx, id) {
        const params = [ctx.organizationId, id];
        let sql = `SELECT * FROM ${resource.table} WHERE organization_id = $1 AND ${resource.idColumn} = $2`;
        if (ctx.projectId) {
            params.push(ctx.projectId);
            sql += ` AND project_id = $${params.length}`;
        }
        sql += ` LIMIT 1`;
        const rows = await this.run(sql, params);
        return rows[0] ?? null;
    }
}
//# sourceMappingURL=repository.js.map