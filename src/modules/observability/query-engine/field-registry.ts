/**
 * Field registry + resource definition contract.
 *
 * An {@link ExplorerResource} is the ONLY thing an explorer must supply. The
 * engine derives filtering, search, sorting, projection, pagination,
 * aggregation, and facet metadata from it. This is the extensibility contract
 * from the architecture doc: add a resource, get a full explorer.
 */
import type {
  FacetDef,
  FieldType,
  FilterOperator,
  SortClause,
} from './types.js';
import { ParamBag } from './operators.js';
import { QueryValidationError } from './errors.js';

/** Definition of one queryable field exposed by a resource. */
export interface FieldDef {
  /** Physical column name (validated: identifier-safe, registry-owned). */
  column: string;
  type: FieldType;
  filterable?: boolean;
  sortable?: boolean;
  searchable?: boolean;
  projectable?: boolean;
  /** SELECT expression override (defaults to the column). Server-defined. */
  selectExpr?: string;
  /** Allowed values for `enum` fields (also surfaced as facet metadata). */
  enumValues?: readonly string[];
  /** Human label for the toolbar facet list. */
  label?: string;
  /** Restrict operators; defaults are derived from the field type. */
  operators?: readonly FilterOperator[];
}

/**
 * A telemetry resource an explorer queries. `mapRow` shapes a raw DB row into
 * the API model; everything else is metadata the engine consumes.
 */
export interface ExplorerResource<TRow = Record<string, unknown>> {
  /** Stable public name, e.g. `requests`. */
  name: string;
  /** Physical table (allow-listed; never user input). */
  table: string;
  /** Time/partition column used for range scans + keyset pagination. */
  timeColumn: string;
  /** Stable unique id column, second key of the pagination tuple. */
  idColumn: string;
  fields: Record<string, FieldDef>;
  /** Public field names scanned for free-text search. */
  searchFields: string[];
  /** Aliases mapping search keys → field names (e.g. `trace` → `traceId`). */
  searchAliases?: Record<string, string>;
  defaultSort: SortClause;
  /** Lightweight column set for list views (defaults to all projectable). */
  defaultProjection?: string[];
  /** Documentation hint of indexes the planner should prefer. */
  preferredIndexes?: string[];
  /** Server-defined SQL boolean marking a row as an "error" for timelines. */
  errorPredicate?: string;
  /** Summary aggregate expressions keyed by output name (server-defined SQL). */
  summary?: Record<string, string>;
  /** Statistics aggregate expressions keyed by output name (server-defined). */
  statistics?: Record<string, string>;
  mapRow: (row: Record<string, unknown>) => TRow;
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/i;
const JSON_KEY_RE = /^[A-Za-z0-9_.:-]+$/;
const JSON_COLUMNS = ['attributes', 'metadata', 'payload'] as const;
type JsonColumn = (typeof JSON_COLUMNS)[number];
/** Prefix → JSON column for path-addressed fields (`attr:foo`, `meta:bar`). */
const JSON_PREFIX: Record<string, JsonColumn> = {
  attr: 'attributes',
  attributes: 'attributes',
  meta: 'metadata',
  metadata: 'metadata',
  payload: 'payload',
};

/** Default operator set for a field type when none is declared. */
export function defaultOperatorsFor(type: FieldType): FilterOperator[] {
  switch (type) {
    case 'number':
    case 'timestamp':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'between', 'exists', 'nexists'];
    case 'boolean':
      return ['eq', 'neq', 'exists', 'nexists'];
    case 'uuid':
      return ['eq', 'neq', 'in', 'nin', 'exists', 'nexists'];
    case 'enum':
      return ['eq', 'neq', 'in', 'nin', 'exists', 'nexists'];
    case 'json':
      return ['eq', 'neq', 'contains', 'ncontains', 'exists', 'nexists'];
    case 'string':
    default:
      return ['eq', 'neq', 'in', 'nin', 'contains', 'ncontains', 'startsWith', 'endsWith', 'exists', 'nexists'];
  }
}

export interface ResolvedField {
  /** SQL expression usable in WHERE/SELECT/ORDER BY. */
  expr: string;
  type: FieldType;
  /** True when the field is a JSON path (`attr:foo`), not a registered column. */
  jsonPath: boolean;
}

/**
 * Resolve a field reference to a safe SQL expression + type.
 *
 * - Registered field ⇒ its `selectExpr`/`column`.
 * - JSON path `attr:foo`/`meta:x`/`payload:y` ⇒ `attributes ->> $n` with the
 *   key bound as a parameter (injection-safe; keys are also format-checked).
 *
 * A `bag` is required only for JSON paths (which bind a key parameter). When
 * omitted, JSON paths are rejected — used by sort/projection where binding a
 * key mid-clause is not supported.
 */
export function resolveField(
  resource: ExplorerResource,
  ref: string,
  bag?: ParamBag,
): ResolvedField {
  const colonIdx = ref.indexOf(':');
  if (colonIdx > 0) {
    const prefix = ref.slice(0, colonIdx).toLowerCase();
    const jsonColumn = JSON_PREFIX[prefix];
    if (jsonColumn) {
      const key = ref.slice(colonIdx + 1);
      if (!JSON_KEY_RE.test(key)) {
        throw new QueryValidationError(`Invalid JSON path key in field '${ref}'`);
      }
      if (!bag) {
        throw new QueryValidationError(`JSON path field '${ref}' is not supported here`);
      }
      return { expr: `${jsonColumn} ->> ${bag.next(key)}`, type: 'string', jsonPath: true };
    }
  }

  const def = resource.fields[ref];
  if (!def) {
    throw new QueryValidationError(`Unknown field '${ref}' for resource '${resource.name}'`, {
      field: ref,
      resource: resource.name,
    });
  }
  if (!IDENT_RE.test(def.column)) {
    // Guards against a malformed resource definition reaching SQL.
    throw new QueryValidationError(`Field '${ref}' has an invalid column mapping`);
  }
  return { expr: def.selectExpr ?? def.column, type: def.type, jsonPath: false };
}

/** Operators allowed for a registered field (respects `operators` override). */
export function operatorsForField(def: FieldDef): FilterOperator[] {
  return def.operators ? [...def.operators] : defaultOperatorsFor(def.type);
}

/** Build the toolbar facet list from the registry (static; no DB round-trip). */
export function buildFacets(resource: ExplorerResource): FacetDef[] {
  const facets: FacetDef[] = [];
  for (const [name, def] of Object.entries(resource.fields)) {
    if (def.filterable === false) continue;
    const facet: FacetDef = {
      field: name,
      label: def.label ?? name,
      type: def.type,
      operators: operatorsForField(def),
    };
    if (def.enumValues) facet.enumValues = def.enumValues;
    facets.push(facet);
  }
  return facets;
}

/** Registry of all explorer resources. Fail-closed lookup. */
export class ResourceRegistry {
  private readonly resources = new Map<string, ExplorerResource>();

  register(resource: ExplorerResource): void {
    this.resources.set(resource.name, resource);
  }

  has(name: string): boolean {
    return this.resources.has(name);
  }

  get(name: string): ExplorerResource | undefined {
    return this.resources.get(name);
  }

  list(): ExplorerResource[] {
    return [...this.resources.values()];
  }

  names(): string[] {
    return [...this.resources.keys()];
  }
}
