/**
 * Search Engine DSL.
 *
 * Parses a search string into structured {@link FilterClause}s plus residual
 * free text. Supported token shapes:
 *
 *   key:value        → eq            (comma-separated ⇒ `in`)
 *   key!=value       → neq
 *   key>value        → gt
 *   key>=value       → gte
 *   key<value        → lt
 *   key<=value       → lte
 *   "quoted phrase"  → free text
 *   bare words       → free text
 *
 * Keys resolve via the resource field registry (and its `searchAliases`).
 * Unknown keys fail closed with a 400 so silent mis-filters can't happen.
 * Free text becomes an ILIKE across the resource's declared `searchFields`.
 */
import type { FilterClause } from './types.js';
import type { ExplorerResource } from './field-registry.js';
export interface ParsedSearch {
    filters: FilterClause[];
    /** Residual free-text terms (already unquoted). */
    text: string[];
}
export declare function parseSearch(resource: ExplorerResource, search: string | undefined): ParsedSearch;
//# sourceMappingURL=search-parser.d.ts.map