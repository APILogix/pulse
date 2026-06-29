/**
 * Deduplication fingerprinting.
 *
 * A fingerprint is a stable SHA-256 hash derived from rule + source + the
 * normalized payload keys. Two events with the same fingerprint within a
 * rule's deduplication window are considered the same alert (the second one
 * increments duplicate_count instead of creating a new firing event).
 */
import { createHash } from 'crypto';

/**
 * Produce a deterministic, order-independent representation of an object's
 * leaf values keyed by dotted path. Arrays are indexed. Used so payloads that
 * differ only in key ordering hash identically.
 */
export function normalizePayload(payload: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (payload === null || payload === undefined) {
    if (prefix) out[prefix] = String(payload);
    return out;
  }
  if (typeof payload !== 'object') {
    out[prefix || '_'] = String(payload);
    return out;
  }
  if (Array.isArray(payload)) {
    payload.forEach((v, i) => Object.assign(out, normalizePayload(v, prefix ? `${prefix}.${i}` : String(i))));
    return out;
  }
  for (const key of Object.keys(payload as Record<string, unknown>).sort()) {
    Object.assign(out, normalizePayload((payload as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

export interface FingerprintInput {
  ruleId: string | null;
  source: string;
  payload: Record<string, unknown>;
  /** Optional subset of payload keys to base the fingerprint on. */
  keyFields?: string[];
}

/** Compute the deduplication fingerprint for an event. */
export function computeFingerprint(input: FingerprintInput): string {
  const normalized = normalizePayload(input.payload);
  const keys = input.keyFields && input.keyFields.length > 0
    ? input.keyFields.slice().sort()
    : Object.keys(normalized).sort();

  const projection = keys.map((k) => `${k}=${normalized[k] ?? ''}`).join('|');
  const material = `${input.ruleId ?? 'norule'}::${input.source}::${projection}`;
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Render a deduplication key template such as
 * `{{rule_id}}:{{source}}:{{fingerprint}}` using the provided context.
 * Unknown placeholders render as empty strings.
 */
export function renderDedupKey(
  template: string,
  ctx: { ruleId: string | null; source: string; fingerprint: string },
): string {
  return template
    .replace(/\{\{\s*rule_id\s*\}\}/g, ctx.ruleId ?? '')
    .replace(/\{\{\s*source\s*\}\}/g, ctx.source)
    .replace(/\{\{\s*fingerprint\s*\}\}/g, ctx.fingerprint);
}
