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
import type { FilterClause, FilterOperator } from './types.js';
import type { ExplorerResource } from './field-registry.js';
import { QueryValidationError } from './errors.js';

export interface ParsedSearch {
  filters: FilterClause[];
  /** Residual free-text terms (already unquoted). */
  text: string[];
}

/** Tokenize respecting double quotes; keeps `key:"a b"` and `"a b"` intact. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === ' ' && !inQuotes) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/** Strip a single layer of wrapping double quotes. */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/** Detect the operator embedded in a token and split key/op/value. */
function splitToken(token: string): { key: string; op: FilterOperator; value: string } | null {
  // Order matters: check two-char operators before single-char.
  const patterns: Array<{ sep: string; op: FilterOperator }> = [
    { sep: '>=', op: 'gte' },
    { sep: '<=', op: 'lte' },
    { sep: '!=', op: 'neq' },
    { sep: ':', op: 'eq' },
    { sep: '>', op: 'gt' },
    { sep: '<', op: 'lt' },
  ];
  let best: { key: string; op: FilterOperator; value: string; idx: number } | null = null;
  for (const { sep, op } of patterns) {
    const idx = token.indexOf(sep);
    if (idx > 0) {
      // Prefer the earliest separator so `latency>=100` beats a later `:`.
      if (!best || idx < best.idx) {
        best = { key: token.slice(0, idx), op, value: token.slice(idx + sep.length), idx };
      }
    }
  }
  if (!best) return null;
  return { key: best.key, op: best.op, value: best.value };
}

/** Resolve a search key to a registered field name (respecting aliases). */
function resolveKey(resource: ExplorerResource, key: string): string | null {
  if (resource.fields[key]) return key;
  const aliased = resource.searchAliases?.[key];
  if (aliased && resource.fields[aliased]) return aliased;
  return null;
}

export function parseSearch(resource: ExplorerResource, search: string | undefined): ParsedSearch {
  const filters: FilterClause[] = [];
  const text: string[] = [];
  if (!search || search.trim().length === 0) return { filters, text };

  for (const token of tokenize(search.trim())) {
    const split = splitToken(token);
    if (!split) {
      text.push(unquote(token));
      continue;
    }

    const fieldName = resolveKey(resource, split.key);
    if (!fieldName) {
      throw new QueryValidationError(`Unknown search key '${split.key}' for resource '${resource.name}'`, {
        key: split.key,
      });
    }

    const rawValue = unquote(split.value);
    if (rawValue.length === 0) {
      throw new QueryValidationError(`Search key '${split.key}' is missing a value`);
    }

    // `key:a,b,c` becomes an `in` filter; comparison ops stay scalar.
    if (split.op === 'eq' && rawValue.includes(',')) {
      const parts = rawValue.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
      filters.push({ field: fieldName, op: 'in', value: parts });
    } else {
      filters.push({ field: fieldName, op: split.op, value: rawValue });
    }
  }

  return { filters, text };
}
