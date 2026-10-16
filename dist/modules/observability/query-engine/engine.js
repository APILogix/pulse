import { buildFacets, buildPublicProjection, isPublicField, operatorsForField } from './field-registry.js';
import { parseSearch } from './search-parser.js';
import { createCursorPayload, encodeCursor } from './cursor.js';
import { buildCombinedAggregateStatement, buildListStatement, buildStatisticsStatement, buildSummaryStatement, buildTimelineStatement, } from './sql-builder.js';
import { QueryValidationError } from './errors.js';
import { isObservabilityQueryCacheable, buildObservabilityQueryCacheKey, getCachedObservabilityQuery, setCachedObservabilityQuery, } from './cache.js';
/** Coerce pg numeric/bigint strings to numbers (missing/NaN ⇒ 0). */
function toNumberMap(row) {
    const out = {};
    if (!row)
        return out;
    for (const [key, value] of Object.entries(row)) {
        if (value === null || value === undefined) {
            out[key] = 0;
            continue;
        }
        const n = typeof value === 'number' ? value : Number(value);
        out[key] = Number.isFinite(n) ? n : 0;
    }
    return out;
}
/** Coerce pg numeric/bigint strings to numbers, preserving nulls. */
function toNullableNumberMap(row) {
    const out = {};
    if (!row)
        return out;
    for (const [key, value] of Object.entries(row)) {
        if (value === null || value === undefined) {
            out[key] = null;
            continue;
        }
        const n = typeof value === 'number' ? value : Number(value);
        out[key] = Number.isFinite(n) ? n : null;
    }
    return out;
}
function rowCursor(row, resource, ctx, query) {
    const rawTime = row.__t;
    const time = rawTime instanceof Date ? rawTime : new Date(String(rawTime));
    if (Number.isNaN(time.getTime()))
        throw new QueryValidationError('Query returned an invalid pagination timestamp');
    return encodeCursor(createCursorPayload(resource, ctx, query, {
        time,
        id: String(row.__id),
    }));
}
export class ExplorerQueryEngine {
    executor;
    constructor(executor) {
        this.executor = executor;
    }
    /**
     * Merge structured filters with parsed search, then validate every clause
     * against the registry (field exists, operator allowed for its type).
     */
    normalize(resource, query) {
        const parsed = parseSearch(resource, query.search);
        const filters = [...query.filters, ...parsed.filters];
        for (const clause of filters) {
            // JSON path fields (attr:foo) are validated at resolve time; registered
            // fields also get an operator allow-list check here.
            if (clause.field.includes(':')) {
                throw new QueryValidationError(`JSON path filters are not supported for '${resource.name}'`);
            }
            {
                const def = resource.fields[clause.field];
                if (!def) {
                    throw new QueryValidationError(`Unknown filter field '${clause.field}' for '${resource.name}'`, {
                        field: clause.field,
                    });
                }
                if (def.filterable === false || !isPublicField(clause.field, def)) {
                    throw new QueryValidationError(`Field '${clause.field}' is not publicly filterable`);
                }
                if (!operatorsForField(def).includes(clause.op)) {
                    throw new QueryValidationError(`Operator '${clause.op}' not allowed for field '${clause.field}'`);
                }
            }
        }
        if (filters.length > 50) {
            throw new QueryValidationError('A maximum of 50 filters is supported');
        }
        for (const clause of filters) {
            if (Array.isArray(clause.value) && clause.value.length > 50) {
                throw new QueryValidationError(`Filter '${clause.field}' has too many values`);
            }
        }
        if (parsed.text.length > 5) {
            throw new QueryValidationError('A maximum of 5 search terms is supported');
        }
        if (parsed.text.some((term) => term.trim().length > 0 && term.trim().length < 2)) {
            throw new QueryValidationError('Search terms must contain at least 2 characters');
        }
        const sortField = query.sort.field;
        const sortDef = resource.fields[sortField];
        const isTimeSort = sortField === resource.timeColumn
            || sortDef?.column === resource.timeColumn;
        if (!isTimeSort) {
            throw new QueryValidationError(`Only time sorting is supported for keyset pagination; received '${sortField}'`);
        }
        return { query: { ...query, filters }, freeText: parsed.text };
    }
    /** Execute a list query and assemble the full explorer envelope. */
    async list(resource, ctx, rawQuery) {
        let cacheKey = null;
        if (isObservabilityQueryCacheable(rawQuery)) {
            cacheKey = buildObservabilityQueryCacheKey(ctx.organizationId, resource.name, rawQuery, ctx);
            const cached = await getCachedObservabilityQuery(cacheKey);
            if (cached) {
                return cached;
            }
        }
        const queryResource = resource;
        const { query, freeText } = this.normalize(queryResource, rawQuery);
        const listStmt = buildListStatement(queryResource, ctx, query, freeText);
        const combinedStmt = buildCombinedAggregateStatement(queryResource, ctx, query, freeText);
        let rawRows = [];
        let summaryRow;
        let statsRow;
        if (combinedStmt) {
            const [listResult, aggResult] = await Promise.all([
                this.executor.run(listStmt.sql, listStmt.params),
                this.executor.run(combinedStmt.sql, combinedStmt.params),
            ]);
            rawRows = listResult;
            const aggFirst = aggResult[0];
            if (aggFirst) {
                if (combinedStmt.summaryKeys.length > 0) {
                    summaryRow = {};
                    for (const key of combinedStmt.summaryKeys) {
                        summaryRow[key] = aggFirst[`s__${key}`] ?? aggFirst[key];
                    }
                }
                if (combinedStmt.statsKeys.length > 0) {
                    statsRow = {};
                    for (const key of combinedStmt.statsKeys) {
                        statsRow[key] = aggFirst[`st__${key}`] ?? aggFirst[key];
                    }
                }
            }
        }
        else {
            rawRows = await this.executor.run(listStmt.sql, listStmt.params);
        }
        const pagination = this.paginate(rawRows, listStmt.reversed, listStmt.limit, query, queryResource, ctx);
        const pageRows = pagination.rows;
        const items = pageRows.map((row) => resource.mapRow(row));
        const response = {
            success: true,
            items,
            pagination: pagination.meta,
            summary: toNumberMap(summaryRow),
            statistics: toNullableNumberMap(statsRow),
            appliedFilters: query.filters,
            availableFilters: buildFacets(queryResource),
            aggregations: {},
            query: {
                resource: resource.name,
                timeRange: { from: query.timeRange.from.toISOString(), to: query.timeRange.to.toISOString() },
                sort: query.sort,
                search: query.search ?? null,
            },
            states: { empty: items.length === 0 },
        };
        if (cacheKey) {
            void setCachedObservabilityQuery(cacheKey, response, 30);
        }
        return response;
    }
    /** Slice the fetched rows and build bidirectional keyset cursors. */
    paginate(rawRows, reversed, limit, query, resource, ctx) {
        const hasMore = rawRows.length > limit;
        let rows = hasMore ? rawRows.slice(0, limit) : rawRows.slice();
        if (reversed)
            rows = rows.reverse();
        const sortDir = query.sort.direction;
        const first = rows[0];
        const last = rows[rows.length - 1];
        const backward = query.direction === 'backward';
        const hasNext = backward ? Boolean(query.cursor) : hasMore;
        const hasPrevious = backward ? hasMore : Boolean(query.cursor);
        const meta = {
            nextCursor: hasNext && last ? rowCursor(last, resource, ctx, query) : null,
            previousCursor: hasPrevious && first ? rowCursor(first, resource, ctx, query) : null,
            hasNext,
            hasPrevious,
            limit,
            direction: query.direction,
        };
        return { rows, meta };
    }
    /** Bucketed timeline for the current filter set (used by detail/summary). */
    async timeline(resource, ctx, rawQuery, interval) {
        const { query, freeText } = this.normalize(resource, rawQuery);
        const stmt = buildTimelineStatement(resource, ctx, query, freeText, interval);
        const rows = await this.executor.run(stmt.sql, stmt.params);
        return rows.map((r) => {
            const bucket = r.bucket;
            return {
                bucket: bucket instanceof Date ? bucket.toISOString() : String(bucket),
                count: Number(r.count),
                errorCount: Number(r.error_count),
            };
        });
    }
    /** Summary aggregates only (no rows) — used by the explicit summary endpoint. */
    async summary(resource, ctx, rawQuery) {
        const { query, freeText } = this.normalize(resource, rawQuery);
        const stmt = buildSummaryStatement(resource, ctx, query, freeText);
        if (!stmt)
            return {};
        const rows = await this.executor.run(stmt.sql, stmt.params);
        return toNumberMap(rows[0]);
    }
    /** Statistics aggregates only — used by the explicit statistics endpoint. */
    async statistics(resource, ctx, rawQuery) {
        const { query, freeText } = this.normalize(resource, rawQuery);
        const stmt = buildStatisticsStatement(resource, ctx, query, freeText);
        if (!stmt)
            return {};
        const rows = await this.executor.run(stmt.sql, stmt.params);
        return toNullableNumberMap(rows[0]);
    }
    /** Resolve a single row by its stable id within the tenant/time scope. */
    async getById(resource, ctx, id) {
        if (!/^[a-z_][a-z0-9_]*$/i.test(resource.idColumn)) {
            throw new QueryValidationError('Invalid id column');
        }
        const queryResource = resource;
        const params = [ctx.organizationId, id];
        let sql = `SELECT ${buildPublicProjection(queryResource)} FROM ${resource.table}
               WHERE organization_id = $1 AND ${resource.idColumn} = $2`;
        if (ctx.projectId) {
            params.push(ctx.projectId);
            sql += ` AND project_id = $${params.length}`;
        }
        else if (ctx.allowedProjectIds !== undefined) {
            if (ctx.allowedProjectIds.length === 0)
                return null;
            params.push(ctx.allowedProjectIds);
            sql += ` AND project_id = ANY($${params.length})`;
        }
        sql += ` LIMIT 1`;
        const rows = await this.executor.run(sql, params);
        const row = rows[0];
        return row ? resource.mapRow(row) : null;
    }
}
//# sourceMappingURL=engine.js.map