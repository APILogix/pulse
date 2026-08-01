/**
 * Unified Explorer Query Engine — orchestrator.
 *
 * The single entry point for querying observability data. Given a resource, a
 * {@link QueryContext}, and an {@link ExplorerQuery}, it validates + normalizes
 * the query (merging parsed search), runs the list/summary/statistics
 * statements, and assembles the shared response envelope with bidirectional
 * keyset cursors. Services depend on this; they never build SQL.
 */
import type { QueryResultRow } from 'pg';
import type {
  ExplorerListResponse,
  ExplorerQuery,
  FilterClause,
  PaginationMeta,
  QueryContext,
  SortDirection,
  TimelineBucket,
} from './types.js';
import type { ExplorerResource } from './field-registry.js';
import { buildFacets, operatorsForField } from './field-registry.js';
import { parseSearch } from './search-parser.js';
import { encodeCursor } from './cursor.js';
import {
  buildListStatement,
  buildStatisticsStatement,
  buildSummaryStatement,
  buildTimelineStatement,
  type TimelineInterval,
} from './sql-builder.js';
import { QueryValidationError } from './errors.js';

/** Minimal execution surface. Backed by the log DB read pool in production. */
export interface QueryExecutor {
  run<T extends QueryResultRow>(sql: string, params: unknown[]): Promise<T[]>;
}

interface NormalizedQuery {
  query: ExplorerQuery;
  freeText: string[];
}

/** Coerce pg numeric/bigint strings to numbers (missing/NaN ⇒ 0). */
function toNumberMap(row: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!row) return out;
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
function toNullableNumberMap(row: Record<string, unknown> | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  if (!row) return out;
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

function rowCursor(row: Record<string, unknown>, dir: SortDirection): string {
  const t = row.__t;
  const iso = t instanceof Date ? t.toISOString() : new Date(String(t)).toISOString();
  return encodeCursor({ t: iso, id: String(row.__id), d: dir });
}

export class ExplorerQueryEngine {
  constructor(private readonly executor: QueryExecutor) {}

  /**
   * Merge structured filters with parsed search, then validate every clause
   * against the registry (field exists, operator allowed for its type).
   */
  private normalize(resource: ExplorerResource, query: ExplorerQuery): NormalizedQuery {
    const parsed = parseSearch(resource, query.search);
    const filters: FilterClause[] = [...query.filters, ...parsed.filters];

    for (const clause of filters) {
      // JSON path fields (attr:foo) are validated at resolve time; registered
      // fields also get an operator allow-list check here.
      if (!clause.field.includes(':')) {
        const def = resource.fields[clause.field];
        if (!def) {
          throw new QueryValidationError(`Unknown filter field '${clause.field}' for '${resource.name}'`, {
            field: clause.field,
          });
        }
        if (def.filterable === false) {
          throw new QueryValidationError(`Field '${clause.field}' is not filterable`);
        }
        if (!operatorsForField(def).includes(clause.op)) {
          throw new QueryValidationError(`Operator '${clause.op}' not allowed for field '${clause.field}'`);
        }
      }
    }

    // Sort must target a sortable field (or the time column).
    const sortField = query.sort.field;
    if (sortField !== resource.timeColumn) {
      const def = resource.fields[sortField];
      if (def && def.sortable === false) {
        throw new QueryValidationError(`Field '${sortField}' is not sortable`);
      }
    }

    return { query: { ...query, filters }, freeText: parsed.text };
  }

  /** Execute a list query and assemble the full explorer envelope. */
  async list<T>(
    resource: ExplorerResource<T>,
    ctx: QueryContext,
    rawQuery: ExplorerQuery,
  ): Promise<ExplorerListResponse<T>> {
    const queryResource = resource as ExplorerResource<Record<string, unknown>>;
    const { query, freeText } = this.normalize(queryResource, rawQuery);

    const listStmt = buildListStatement(queryResource, ctx, query, freeText);
    const summaryStmt = buildSummaryStatement(queryResource, ctx, query, freeText);
    const statsStmt = buildStatisticsStatement(queryResource, ctx, query, freeText);

    const [rawRows, summaryRows, statsRows] = await Promise.all([
      this.executor.run<Record<string, unknown>>(listStmt.sql, listStmt.params),
      summaryStmt
        ? this.executor.run<Record<string, unknown>>(summaryStmt.sql, summaryStmt.params)
        : Promise.resolve<Record<string, unknown>[]>([]),
      statsStmt
        ? this.executor.run<Record<string, unknown>>(statsStmt.sql, statsStmt.params)
        : Promise.resolve<Record<string, unknown>[]>([]),
    ]);

    const pagination = this.paginate(rawRows, listStmt.reversed, listStmt.limit, query);
    const pageRows = pagination.rows;
    const items = pageRows.map((row) => resource.mapRow(row));

    return {
      success: true,
      items,
      pagination: pagination.meta,
      summary: toNumberMap(summaryRows[0]),
      statistics: toNullableNumberMap(statsRows[0]),
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
  }

  /** Slice the fetched rows and build bidirectional keyset cursors. */
  private paginate(
    rawRows: Array<Record<string, unknown>>,
    reversed: boolean,
    limit: number,
    query: ExplorerQuery,
  ): { rows: Array<Record<string, unknown>>; meta: PaginationMeta } {
    const hasMore = rawRows.length > limit;
    let rows = hasMore ? rawRows.slice(0, limit) : rawRows.slice();
    if (reversed) rows = rows.reverse();

    const sortDir = query.sort.direction;
    const first = rows[0];
    const last = rows[rows.length - 1];

    const backward = query.direction === 'backward';
    const hasNext = backward ? Boolean(query.cursor) : hasMore;
    const hasPrevious = backward ? hasMore : Boolean(query.cursor);

    const meta: PaginationMeta = {
      nextCursor: hasNext && last ? rowCursor(last, sortDir) : null,
      previousCursor: hasPrevious && first ? rowCursor(first, sortDir) : null,
      hasNext,
      hasPrevious,
      limit,
      direction: query.direction,
    };
    return { rows, meta };
  }

  /** Bucketed timeline for the current filter set (used by detail/summary). */
  async timeline(
    resource: ExplorerResource,
    ctx: QueryContext,
    rawQuery: ExplorerQuery,
    interval: TimelineInterval,
  ): Promise<TimelineBucket[]> {
    const { query, freeText } = this.normalize(resource, rawQuery);
    const stmt = buildTimelineStatement(resource, ctx, query, freeText, interval);
    const rows = await this.executor.run<Record<string, unknown>>(stmt.sql, stmt.params);
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
  async summary(resource: ExplorerResource, ctx: QueryContext, rawQuery: ExplorerQuery): Promise<Record<string, number>> {
    const { query, freeText } = this.normalize(resource, rawQuery);
    const stmt = buildSummaryStatement(resource, ctx, query, freeText);
    if (!stmt) return {};
    const rows = await this.executor.run<Record<string, unknown>>(stmt.sql, stmt.params);
    return toNumberMap(rows[0]);
  }

  /** Statistics aggregates only — used by the explicit statistics endpoint. */
  async statistics(resource: ExplorerResource, ctx: QueryContext, rawQuery: ExplorerQuery): Promise<Record<string, number | null>> {
    const { query, freeText } = this.normalize(resource, rawQuery);
    const stmt = buildStatisticsStatement(resource, ctx, query, freeText);
    if (!stmt) return {};
    const rows = await this.executor.run<Record<string, unknown>>(stmt.sql, stmt.params);
    return toNullableNumberMap(rows[0]);
  }

  /** Resolve a single row by its stable id within the tenant/time scope. */
  async getById<T>(
    resource: ExplorerResource<T>,
    ctx: QueryContext,
    id: string,
  ): Promise<T | null> {
    if (!/^[a-z_][a-z0-9_]*$/i.test(resource.idColumn)) {
      throw new QueryValidationError('Invalid id column');
    }
    const params: unknown[] = [ctx.organizationId, id];
    let sql = `SELECT * FROM ${resource.table} WHERE organization_id = $1 AND ${resource.idColumn} = $2`;
    if (ctx.projectId) {
      params.push(ctx.projectId);
      sql += ` AND project_id = $${params.length}`;
    }
    sql += ` LIMIT 1`;
    const rows = await this.executor.run<Record<string, unknown>>(sql, params);
    const row = rows[0];
    return row ? resource.mapRow(row) : null;
  }
}
