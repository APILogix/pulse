/**
 * Unified Explorer Query Engine — core types.
 *
 * These types define the internal Observability Query DSL and the shared
 * response envelope that every explorer (requests, errors, logs, traces,
 * spans, metrics, crons, profiles, …) returns. Controllers and services never
 * build SQL; they build an {@link ExplorerQuery} and hand it to the engine.
 *
 * See docs/observability-explorer/00-architecture.md (Phase 4).
 */

/** Value domain of a queryable field. Drives validation and coercion. */
export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'uuid'
  | 'timestamp'
  | 'enum'
  | 'json';

/** Supported filter operators. Each maps to a parameterized SQL fragment. */
export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'nin'
  | 'contains'
  | 'ncontains'
  | 'startsWith'
  | 'endsWith'
  | 'exists'
  | 'nexists'
  | 'between';

export type SortDirection = 'asc' | 'desc';

/** A single, validated filter predicate against a registered field. */
export interface FilterClause {
  /** Public field name, or a JSON path ref like `attr:foo` / `payload:bar`. */
  field: string;
  op: FilterOperator;
  /** Value(s). Arrays for `in`/`nin`; 2-tuples for `between`; ignored for exists. */
  value?: unknown;
}

export interface SortClause {
  field: string;
  direction: SortDirection;
}

/** Concrete, resolved time window. Half-open interval [from, to). */
export interface TimeRange {
  from: Date;
  to: Date;
}

/** Pagination direction relative to the supplied cursor. */
export type PageDirection = 'forward' | 'backward';

/**
 * The internal query DSL. Produced from HTTP input by the query schema and the
 * search parser, then consumed by the SQL builder + engine.
 */
export interface ExplorerQuery {
  timeRange: TimeRange;
  projectId?: string;
  environment?: string;
  /** Free-text + structured search string (parsed into filters + text). */
  search?: string;
  /** Fully validated structured filters. */
  filters: FilterClause[];
  /** Primary sort. Only the time column is used for keyset pagination. */
  sort: SortClause;
  cursor?: string;
  direction: PageDirection;
  limit: number;
  /** Projection allow-list of public field names. Empty ⇒ default projection. */
  fields?: string[];
  live: boolean;
}

/**
 * Tenant + permission context resolved once per request. The engine injects
 * these predicates so tenant isolation can never be bypassed by a filter.
 */
export interface QueryContext {
  organizationId: string;
  userId?: string;
  /** When set, the caller is scoped to a single project. */
  projectId?: string;
  /** When set, the caller is scoped to a single environment. */
  environment?: string;
  /** When set, restricts visible projects to this allow-list (RBAC). */
  allowedProjectIds?: string[];
  role?: string;
  plan?: string;
  /** IANA timezone for bucketing/labels. */
  timezone?: string;
  /** Oldest queryable instant permitted by plan retention. */
  retentionFloor?: Date;
  featureFlags?: Record<string, boolean>;
}

export interface PaginationMeta {
  nextCursor: string | null;
  previousCursor: string | null;
  hasNext: boolean;
  hasPrevious: boolean;
  limit: number;
  direction: PageDirection;
}

/** Facet metadata for the toolbar's "available filters", from the registry. */
export interface FacetDef {
  field: string;
  label: string;
  type: FieldType;
  operators: FilterOperator[];
  enumValues?: readonly string[];
}

export interface ExplorerListResponse<T> {
  success: true;
  items: T[];
  pagination: PaginationMeta;
  summary: Record<string, number>;
  statistics: Record<string, number | null>;
  appliedFilters: FilterClause[];
  availableFilters: FacetDef[];
  aggregations: Record<string, unknown>;
  query: {
    resource: string;
    timeRange: { from: string; to: string };
    sort: SortClause;
    search: string | null;
  };
  states: { empty: boolean };
}

export interface TimelineBucket {
  bucket: string;
  count: number;
  errorCount: number;
}
