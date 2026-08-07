/**
 * Field registry + resource definition contract.
 *
 * An {@link ExplorerResource} is the ONLY thing an explorer must supply. The
 * engine derives filtering, search, sorting, projection, pagination,
 * aggregation, and facet metadata from it. This is the extensibility contract
 * from the architecture doc: add a resource, get a full explorer.
 */
import type { FacetDef, FieldType, FilterOperator, SortClause } from './types.js';
import { ParamBag } from './operators.js';
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
export declare function isPublicField(name: string, def: FieldDef): boolean;
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
/** Default operator set for a field type when none is declared. */
export declare function defaultOperatorsFor(type: FieldType): FilterOperator[];
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
export declare function resolveField(resource: ExplorerResource, ref: string, bag?: ParamBag): ResolvedField;
/** Operators allowed for a registered field (respects `operators` override). */
export declare function operatorsForField(def: FieldDef): FilterOperator[];
/** Build the toolbar facet list from the registry (static; no DB round-trip). */
export declare function buildFacets(resource: ExplorerResource): FacetDef[];
/** Build a server-owned public projection for a resource. */
export declare function buildPublicProjection(resource: ExplorerResource): string;
/** Build an explicit detail projection including server-only correlation data. */
export declare function buildDetailProjection(resource: ExplorerResource): string;
/** Redact a raw detail row down to the resource's public fields. */
export declare function projectPublicRow(resource: ExplorerResource, row: Record<string, unknown>): Record<string, unknown>;
/** Registry of all explorer resources. Fail-closed lookup. */
export declare class ResourceRegistry {
    private readonly resources;
    register(resource: ExplorerResource): void;
    has(name: string): boolean;
    get(name: string): ExplorerResource | undefined;
    list(): ExplorerResource[];
    names(): string[];
}
//# sourceMappingURL=field-registry.d.ts.map