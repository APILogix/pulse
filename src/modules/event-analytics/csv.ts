/**
 * CSV serialization helper (pure — no DB/env imports).
 *
 * Serializes an array of flat objects to CSV. The header is the union of all
 * keys across rows; object values are JSON-encoded; fields containing quotes,
 * commas, or newlines are quoted with RFC-4180 escaping.
 */
export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = keys.join(',');
  const lines = rows.map((r) => keys.map((k) => escape(r[k])).join(','));
  return [header, ...lines].join('\n');
}
