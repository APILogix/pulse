/**
 * CSV serialization helper (pure — no DB/env imports).
 *
 * Serializes an array of flat objects to CSV. The header is the union of all
 * keys across rows; object values are JSON-encoded; fields containing quotes,
 * commas, or newlines are quoted with RFC-4180 escaping.
 */
export declare function toCsv(rows: Array<Record<string, unknown>>): string;
//# sourceMappingURL=csv.d.ts.map