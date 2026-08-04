/**
 * HTTP → DSL translation. Validates raw query parameters (all strings on the
 * wire) and produces a typed {@link ExplorerQuery}. This is the only place raw
 * request input becomes a query object; the engine trusts what comes out.
 */
import { z } from 'zod';
import type {
  ExplorerQuery,
  FilterClause,
  FilterOperator,
  PageDirection,
  SortClause,
  SortDirection,
  TimeRange,
} from './types.js';
import { QueryValidationError } from './errors.js';

export const RANGE_MS: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

const OPERATORS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin',
  'contains', 'ncontains', 'startsWith', 'endsWith', 'exists', 'nexists', 'between',
] as const satisfies readonly FilterOperator[];

const FilterClauseSchema = z.object({
  field: z.string().min(1).max(128),
  op: z.enum(OPERATORS),
  value: z.unknown().optional(),
});

/** Raw, wire-level query parameters shared by every explorer list endpoint. */
export const RawExplorerQuerySchema = z.object({
  search: z.string().max(2000).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  range: z.enum(['15m', '1h', '6h', '24h', '7d', '30d', '90d']).optional(),
  environment: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).optional(),
  projectId: z.string().uuid().optional(),
  sort: z.string().max(128).optional(),
  cursor: z.string().max(4096).optional(),
  direction: z.enum(['forward', 'backward']).default('forward'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  fields: z.string().max(2000).optional(),
  filters: z.string().max(20000).optional(),
  // z.coerce.boolean() treats the string "false" as true; parse explicitly.
  live: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((v) => (v === undefined ? undefined : typeof v === 'boolean' ? v : v === 'true' || v === '1')),
});
export type RawExplorerQuery = z.infer<typeof RawExplorerQuerySchema>;

/** Resolve explicit from/to or a named range into a concrete window. */
export function resolveTimeRange(raw: { from?: Date; to?: Date; range?: string }): TimeRange {
  const to = raw.to ?? new Date();
  if (raw.from) {
    if (raw.from >= to) throw new QueryValidationError('`from` must be before `to`');
    return { from: raw.from, to };
  }
  const ms = RANGE_MS[raw.range ?? '24h'] ?? RANGE_MS['24h']!;
  return { from: new Date(to.getTime() - ms), to };
}

/** Parse `field:dir` (dir optional) against the resource's default sort. */
function parseSort(raw: string | undefined, fallback: SortClause): SortClause {
  if (!raw) return fallback;
  const [field, dir] = raw.split(':');
  if (!field) return fallback;
  const direction: SortDirection = dir === 'asc' ? 'asc' : dir === 'desc' ? 'desc' : fallback.direction;
  return { field, direction };
}

/** Parse the JSON-encoded structured filters parameter. */
function parseFilters(raw: string | undefined): FilterClause[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new QueryValidationError('`filters` must be valid JSON');
  }
  const result = z.array(FilterClauseSchema).max(50).safeParse(parsed);
  if (!result.success) {
    throw new QueryValidationError('`filters` has an invalid shape', { issues: result.error.issues });
  }
  return result.data.map((c) => (c.value === undefined ? { field: c.field, op: c.op } : { field: c.field, op: c.op, value: c.value }));
}

function splitCsv(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  return parts.length > 0 ? parts : undefined;
}

/**
 * Build a validated {@link ExplorerQuery} from raw request query params.
 * `defaultSort` comes from the resource so each explorer keeps its natural
 * ordering (usually time DESC).
 */
export function buildExplorerQuery(rawInput: unknown, defaultSort: SortClause): ExplorerQuery {
  const parsed = RawExplorerQuerySchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    throw new QueryValidationError('Invalid explorer query', { issues: parsed.error.issues });
  }
  const raw = parsed.data;
  const timeInput: { from?: Date; to?: Date; range?: string } = {};
  if (raw.from !== undefined) timeInput.from = raw.from;
  if (raw.to !== undefined) timeInput.to = raw.to;
  if (raw.range !== undefined) timeInput.range = raw.range;
  const timeRange = resolveTimeRange(timeInput);
  const sort = parseSort(raw.sort, defaultSort);
  const fields = splitCsv(raw.fields);
  const direction: PageDirection = raw.direction;

  const query: ExplorerQuery = {
    timeRange,
    filters: parseFilters(raw.filters),
    sort,
    direction,
    limit: raw.limit,
    live: raw.live ?? false,
  };
  if (raw.search !== undefined) query.search = raw.search;
  if (raw.projectId !== undefined) query.projectId = raw.projectId;
  if (raw.environment !== undefined) query.environment = raw.environment;
  if (raw.cursor !== undefined) query.cursor = raw.cursor;
  if (fields !== undefined) query.fields = fields;
  return query;
}
