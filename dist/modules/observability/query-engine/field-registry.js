import { ParamBag } from './operators.js';
import { QueryValidationError } from './errors.js';
/**
 * A telemetry resource an explorer queries. `mapRow` shapes a raw DB row into
 * the API model; everything else is metadata the engine consumes.
 */
const INTERNAL_FIELD_NAMES = new Set([
    'organizationId', 'projectId', 'tenantId', 'apiKeyName', 'userId',
    'userEmail', 'userIp', 'clientIp', 'clientIpHash', 'netHostIp', 'netPeerIp',
    'ingestedAt', 'createdAt', 'attributes', 'metadata', 'payload', 'aiResponse', 'profileData',
]);
export function isPublicField(name, def) {
    return def.projectable !== false && !INTERNAL_FIELD_NAMES.has(name);
}
const IDENT_RE = /^[a-z_][a-z0-9_]*$/i;
const JSON_KEY_RE = /^[A-Za-z0-9_.:-]+$/;
const JSON_COLUMNS = ['attributes', 'metadata', 'payload'];
/** Prefix → JSON column for path-addressed fields (`attr:foo`, `meta:bar`). */
const JSON_PREFIX = {
    attr: 'attributes',
    attributes: 'attributes',
    meta: 'metadata',
    metadata: 'metadata',
    payload: 'payload',
};
/** Default operator set for a field type when none is declared. */
export function defaultOperatorsFor(type) {
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
export function resolveField(resource, ref, bag) {
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
export function operatorsForField(def) {
    return def.operators ? [...def.operators] : defaultOperatorsFor(def.type);
}
/** Build the toolbar facet list from the registry (static; no DB round-trip). */
export function buildFacets(resource) {
    const facets = [];
    for (const [name, def] of Object.entries(resource.fields)) {
        if (def.filterable === false || !isPublicField(name, def))
            continue;
        const facet = {
            field: name,
            label: def.label ?? name,
            type: def.type,
            operators: operatorsForField(def),
        };
        if (def.enumValues)
            facet.enumValues = def.enumValues;
        facets.push(facet);
    }
    return facets;
}
/** Build a server-owned public projection for a resource. */
export function buildPublicProjection(resource) {
    const names = resource.defaultProjection?.length
        ? resource.defaultProjection.filter((name) => {
            const def = resource.fields[name];
            return def !== undefined && isPublicField(name, def);
        })
        : Object.entries(resource.fields)
            .filter(([name, def]) => isPublicField(name, def))
            .map(([name]) => name);
    return names.map((name) => {
        const def = resource.fields[name];
        if (!def || !IDENT_RE.test(def.column) || name.includes('"')) {
            throw new QueryValidationError(`Invalid public projection field '${name}'`);
        }
        return `${def.selectExpr ?? def.column} AS "${name}"`;
    }).join(', ');
}
/** Build an explicit detail projection including server-only correlation data. */
export function buildDetailProjection(resource) {
    const columns = new Set();
    for (const def of Object.values(resource.fields)) {
        if (!def.selectExpr && IDENT_RE.test(def.column))
            columns.add(def.column);
    }
    columns.add(resource.idColumn);
    columns.add(resource.timeColumn);
    const physical = [...columns].map((column) => `${column} AS "${column}"`);
    const publicFields = Object.entries(resource.fields)
        .filter(([name, def]) => isPublicField(name, def))
        .filter(([name, def]) => name !== def.column && !name.includes('"'))
        .map(([name, def]) => `${def.selectExpr ?? def.column} AS "${name}"`);
    return [...physical, ...publicFields].join(', ');
}
/** Redact a raw detail row down to the resource's public fields. */
export function projectPublicRow(resource, row) {
    const projected = {};
    for (const [name, def] of Object.entries(resource.fields)) {
        if (!isPublicField(name, def))
            continue;
        if (Object.prototype.hasOwnProperty.call(row, name))
            projected[name] = row[name];
    }
    return projected;
}
/** Registry of all explorer resources. Fail-closed lookup. */
export class ResourceRegistry {
    resources = new Map();
    register(resource) {
        this.resources.set(resource.name, resource);
    }
    has(name) {
        return this.resources.has(name);
    }
    get(name) {
        return this.resources.get(name);
    }
    list() {
        return [...this.resources.values()];
    }
    names() {
        return [...this.resources.keys()];
    }
}
//# sourceMappingURL=field-registry.js.map