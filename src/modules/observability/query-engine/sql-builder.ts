/**
 * SQL builder. Deterministic, fully parameterized, index-aware SQL generation
 * for the shared explorer contract. Every statement:
 *   - leads with `organization_id = $1` (+ project/environment) then the time
 *     range, matching `idx_<table>_tenant_env_time` / `_tenant_time`;
 *   - binds every value through {@link ParamBag} (no string interpolation of
 *     values); identifiers come only from the server-defined registry;
 *   - uses keyset (tuple) comparison for pagination — never OFFSET.
 */
import type { ExplorerQuery, FilterClause, QueryContext, SortDirection } from './types.js';
import type { ExplorerResource } from './field-registry.js';
import { resolveField } from './field-registry.js';
import { ParamBag, buildOperatorFragment } from './operators.js';
import { decodeCursor } from './cursor.js';
import { QueryValidationError } from './errors.js';

export interface BuiltStatement {
  sql: string;
  params: unknown[];
}

export interface BuiltListStatement extends BuiltStatement {
  /** True when rows were fetched in reversed order (backward paging). */
  reversed: boolean;
  /** Row limit requested (the SQL fetches limit + 1 to detect more pages). */
  limit: number;
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/i;

function assertIdent(name: string, kind: string): void {
  if (!IDENT_RE.test(name)) {
    throw new QueryValidationError(`Invalid ${kind} identifier`);
  }
}

/** Effective time window, clamped to the plan retention floor. */
function effectiveWindow(ctx: QueryContext, query: ExplorerQuery): { from: Date; to: Date } {
  const from = ctx.retentionFloor && query.timeRange.from < ctx.retentionFloor
    ? ctx.retentionFloor
    : query.timeRange.from;
  return { from, to: query.timeRange.to };
}

/** Predicate for a single validated filter clause. */
function buildFilterPredicate(resource: ExplorerResource, clause: FilterClause, bag: ParamBag): string {
  const resolved = resolveField(resource, clause.field, bag);
  return buildOperatorFragment(resolved.expr, clause.op, resolved.type, clause.value, clause.field, bag);
}

/** OR of ILIKE across the resource's searchFields for each free-text term. */
function buildFreeTextPredicate(resource: ExplorerResource, terms: string[], bag: ParamBag): string[] {
  if (terms.length === 0 || resource.searchFields.length === 0) return [];
  const preds: string[] = [];
  for (const term of terms) {
    const placeholder = bag.next(`%${term.replace(/([%_\\])/g, '\\$1')}%`);
    const ors = resource.searchFields.map((name) => {
      const resolved = resolveField(resource, name);
      return `${resolved.expr} ILIKE ${placeholder}`;
    });
    preds.push(`(${ors.join(' OR ')})`);
  }
  return preds;
}

/**
 * Shared WHERE predicates: tenant isolation, project/environment scoping, the
 * (clamped) time window, structured filters, and free-text terms. Excludes the
 * cursor predicate so summary/statistics/timeline can reuse it verbatim.
 */
export function buildScopePredicates(
  resource: ExplorerResource,
  ctx: QueryContext,
  query: ExplorerQuery,
  bag: ParamBag,
  freeText: string[],
): string[] {
  assertIdent(resource.timeColumn, 'time column');
  assertIdent(resource.idColumn, 'id column');

  const preds: string[] = [];
  preds.push(`organization_id = ${bag.next(ctx.organizationId)}`);

  const projectId = query.projectId ?? ctx.projectId;
  if (projectId) {
    preds.push(`project_id = ${bag.next(projectId)}`);
  }
  if (ctx.allowedProjectIds && ctx.allowedProjectIds.length > 0) {
    preds.push(`project_id = ANY(${bag.next(ctx.allowedProjectIds)})`);
  }

  const environment = query.environment ?? ctx.environment;
  if (environment) {
    preds.push(`environment = ${bag.next(environment)}`);
  }

  const window = effectiveWindow(ctx, query);
  preds.push(`${resource.timeColumn} >= ${bag.next(window.from)}`);
  preds.push(`${resource.timeColumn} < ${bag.next(window.to)}`);

  for (const clause of query.filters) {
    preds.push(buildFilterPredicate(resource, clause, bag));
  }
  preds.push(...buildFreeTextPredicate(resource, freeText, bag));

  return preds;
}

/** Choose the projected field set (requested ∩ projectable, or defaults). */
function resolveProjection(resource: ExplorerResource, fields: string[] | undefined): string[] {
  const projectable = Object.entries(resource.fields)
    .filter(([, def]) => def.projectable !== false)
    .map(([name]) => name);

  if (!fields || fields.length === 0) {
    return resource.defaultProjection && resource.defaultProjection.length > 0
      ? resource.defaultProjection
      : projectable;
  }
  for (const f of fields) {
    if (!projectable.includes(f)) {
      throw new QueryValidationError(`Field '${f}' is not projectable for resource '${resource.name}'`, { field: f });
    }
  }
  return fields;
}

/** Build the SELECT list, always including the internal cursor columns. */
function buildSelectList(resource: ExplorerResource, fields: string[] | undefined): string {
  const chosen = resolveProjection(resource, fields);
  const parts: string[] = [];
  for (const name of chosen) {
    if (name.includes('"')) throw new QueryValidationError(`Invalid field name '${name}'`);
    const def = resource.fields[name];
    if (!def) throw new QueryValidationError(`Unknown field '${name}' for resource '${resource.name}'`);
    const expr = def.selectExpr ?? def.column;
    parts.push(`${expr} AS "${name}"`);
  }
  // Internal, stable cursor columns (mapRow ignores them).
  parts.push(`${resource.idColumn} AS "__id"`);
  parts.push(`${resource.timeColumn} AS "__t"`);
  return parts.join(', ');
}

/** Invert a sort direction. */
function invert(dir: SortDirection): SortDirection {
  return dir === 'desc' ? 'asc' : 'desc';
}

/**
 * Build the paginated list statement. Keyset pagination on `(timeColumn,
 * idColumn)`. Fetches `limit + 1` rows so the engine can report `hasNext`.
 */
export function buildListStatement(
  resource: ExplorerResource,
  ctx: QueryContext,
  query: ExplorerQuery,
  freeText: string[],
): BuiltListStatement {
  const bag = new ParamBag();
  const preds = buildScopePredicates(resource, ctx, query, bag, freeText);

  const sortDir = query.sort.direction;
  // Backward paging fetches in the opposite order, then the engine reverses.
  const backward = query.direction === 'backward';
  const scanDir: SortDirection = backward ? invert(sortDir) : sortDir;

  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    const cmp = scanDir === 'desc' ? '<' : '>';
    const tParam = bag.next(new Date(cursor.t));
    const idParam = bag.next(cursor.id);
    preds.push(`(${resource.timeColumn}, ${resource.idColumn}) ${cmp} (${tParam}, ${idParam})`);
  }

  const orderSql = `${resource.timeColumn} ${scanDir.toUpperCase()}, ${resource.idColumn} ${scanDir.toUpperCase()}`;
  const limitParam = bag.next(query.limit + 1);
  const select = buildSelectList(resource, query.fields);

  const sql = `SELECT ${select} FROM ${resource.table} WHERE ${preds.join(' AND ')} ORDER BY ${orderSql} LIMIT ${limitParam}`;
  return { sql, params: bag.params, reversed: backward, limit: query.limit };
}

/** Build the summary aggregate statement from the resource's `summary` map. */
export function buildSummaryStatement(
  resource: ExplorerResource,
  ctx: QueryContext,
  query: ExplorerQuery,
  freeText: string[],
): BuiltStatement | null {
  if (!resource.summary || Object.keys(resource.summary).length === 0) return null;
  const bag = new ParamBag();
  const preds = buildScopePredicates(resource, ctx, query, bag, freeText);
  const selects = Object.entries(resource.summary).map(([name, expr]) => {
    if (name.includes('"')) throw new QueryValidationError('Invalid summary alias');
    return `${expr} AS "${name}"`;
  });
  const sql = `SELECT ${selects.join(', ')} FROM ${resource.table} WHERE ${preds.join(' AND ')}`;
  return { sql, params: bag.params };
}

/** Build the statistics aggregate statement from the resource's `statistics`. */
export function buildStatisticsStatement(
  resource: ExplorerResource,
  ctx: QueryContext,
  query: ExplorerQuery,
  freeText: string[],
): BuiltStatement | null {
  if (!resource.statistics || Object.keys(resource.statistics).length === 0) return null;
  const bag = new ParamBag();
  const preds = buildScopePredicates(resource, ctx, query, bag, freeText);
  const selects = Object.entries(resource.statistics).map(([name, expr]) => {
    if (name.includes('"')) throw new QueryValidationError('Invalid statistics alias');
    return `${expr} AS "${name}"`;
  });
  const sql = `SELECT ${selects.join(', ')} FROM ${resource.table} WHERE ${preds.join(' AND ')}`;
  return { sql, params: bag.params };
}

export type TimelineInterval = 'minute' | 'hour' | 'day';

/** Build a bucketed timeline (count + error count) over the filtered window. */
export function buildTimelineStatement(
  resource: ExplorerResource,
  ctx: QueryContext,
  query: ExplorerQuery,
  freeText: string[],
  interval: TimelineInterval,
): BuiltStatement {
  const bag = new ParamBag();
  const preds = buildScopePredicates(resource, ctx, query, bag, freeText);
  // `error` classification is resource-driven; fall back to severity levels
  // that exist on every canonical event table.
  const errorExpr = resource.errorPredicate
    ? `COUNT(*) FILTER (WHERE ${resource.errorPredicate})`
    : `COUNT(*) FILTER (WHERE severity IN ('error','critical','fatal'))`;
  const sql = `
    SELECT date_trunc(${bag.next(interval)}, ${resource.timeColumn}) AS bucket,
           COUNT(*)::bigint AS count,
           (${errorExpr})::bigint AS error_count
    FROM ${resource.table}
    WHERE ${preds.join(' AND ')}
    GROUP BY bucket
    ORDER BY bucket ASC
    LIMIT 2000
  `.trim();
  return { sql, params: bag.params };
}
