/**
 * AnalyticsQueryBuilder — a small, safe, parameterized SQL builder for the
 * read-heavy analytics endpoints.
 *
 * Safety:
 *   - Table names are validated against an allow-list (never interpolated from
 *     user input) to eliminate SQL injection via identifiers.
 *   - All values are bound as parameters ($1, $2, …); nothing is concatenated.
 *   - `organization_id = $1` is always the first predicate (tenant isolation).
 *
 * Performance:
 *   - Every builder starts org-scoped and time-ranged so queries hit the
 *     composite/BRIN indexes from migration 004.
 */
export const ANALYTICS_TABLES = {
  errors: 'events_errors',
  messages: 'events_messages',
  requests: 'events_requests',
  spans: 'events_spans',
  traces: 'events_traces',
  metrics: 'events_metrics',
  logs: 'events_logs',
  profiles: 'events_profiles',
  crons: 'events_cron_checkins',
  replays: 'events_replays',
} as const;

export type AnalyticsTableKey = keyof typeof ANALYTICS_TABLES;

export type TimeBucket = 'hour' | 'day' | 'week';

export class AnalyticsQueryBuilder {
  private readonly table: string;
  private readonly conditions: string[] = [];
  private readonly params: unknown[] = [];
  private orderByClause = '';
  private limitClause = '';

  constructor(tableKey: AnalyticsTableKey, orgId: string) {
    const resolved = ANALYTICS_TABLES[tableKey];
    if (!resolved) throw new Error(`Unknown analytics table: ${tableKey}`);
    this.table = resolved;
    this.params.push(orgId);
    this.conditions.push(`organization_id = $1`);
  }

  private next(): string {
    return `$${this.params.length + 1}`;
  }

  whereTimeRange(start: Date, end: Date, column = 'timestamp'): this {
    this.conditions.push(`${column} >= ${this.next()}`);
    this.params.push(start);
    this.conditions.push(`${column} < ${this.next()}`);
    this.params.push(end);
    return this;
  }

  whereProject(projectId?: string): this {
    if (!projectId) return this;
    this.conditions.push(`project_id = ${this.next()}`);
    this.params.push(projectId);
    return this;
  }

  whereEq(column: string, value: unknown): this {
    if (value === undefined || value === null) return this;
    this.conditions.push(`${column} = ${this.next()}`);
    this.params.push(value);
    return this;
  }

  whereRaw(fragment: string, value: unknown): this {
    if (value === undefined || value === null) return this;
    this.conditions.push(fragment.replace('?', this.next()));
    this.params.push(value);
    return this;
  }

  whereTrue(column: string, enabled?: boolean): this {
    if (enabled) this.conditions.push(`${column} = true`);
    return this;
  }

  whereSearch(column: string, query?: string): this {
    if (!query) return this;
    this.conditions.push(`${column} ILIKE ${this.next()}`);
    this.params.push(`%${query}%`);
    return this;
  }

  whereFullText(column: string, query?: string): this {
    if (!query) return this;
    this.conditions.push(`to_tsvector('english', ${column}) @@ plainto_tsquery('english', ${this.next()})`);
    this.params.push(query);
    return this;
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'desc'): this {
    const dir = direction === 'asc' ? 'ASC' : 'DESC';
    this.orderByClause = `ORDER BY ${column} ${dir}`;
    return this;
  }

  paginate(limit: number, offset: number): this {
    this.params.push(limit);
    const limitParam = `$${this.params.length}`;
    this.params.push(offset);
    const offsetParam = `$${this.params.length}`;
    this.limitClause = `LIMIT ${limitParam} OFFSET ${offsetParam}`;
    return this;
  }

  private whereClause(): string {
    return this.conditions.join(' AND ');
  }

  /** SELECT specific columns. */
  select(columns = '*'): { sql: string; params: unknown[] } {
    return {
      sql: `SELECT ${columns} FROM ${this.table} WHERE ${this.whereClause()} ${this.orderByClause} ${this.limitClause}`.trim(),
      params: this.params,
    };
  }

  /** COUNT(*) for the current predicates (ignores order/limit). */
  count(): { sql: string; params: unknown[] } {
    return {
      sql: `SELECT COUNT(*)::bigint AS count FROM ${this.table} WHERE ${this.whereClause()}`,
      params: this.params,
    };
  }

  /**
   * Time-series bucketed counts. `extraSelects` allows additional aggregate
   * expressions (already safe, server-defined — never user input).
   */
  timeSeries(bucket: TimeBucket, extraSelects = ''): { sql: string; params: unknown[] } {
    const trunc = `DATE_TRUNC('${bucket}', timestamp)`;
    const extra = extraSelects ? `, ${extraSelects}` : '';
    return {
      sql: `
        SELECT ${trunc} AS bucket, COUNT(*)::bigint AS count${extra}
        FROM ${this.table}
        WHERE ${this.whereClause()}
        GROUP BY bucket
        ORDER BY bucket ASC
        LIMIT 5000
      `.trim(),
      params: this.params,
    };
  }
}
