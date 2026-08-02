import { createHash } from 'crypto';
const SECRET_PATTERNS = [
    [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi, 'Bearer [REDACTED]'],
    [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/g, '[REDACTED_API_KEY]'],
    [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
    [/\b(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]'],
    [/\bpostgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_CONNECTION_STRING]'],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
    [/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_PAYMENT_CARD]'],
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]'],
];
const INJECTION_PATTERNS = [
    /ignore\s+(?:all\s+)?(?:previous|prior|system)\s+instructions?/i,
    /reveal\s+(?:the\s+)?(?:system|developer|master)\s+prompt/i,
    /(?:print|show|expose)\s+(?:all\s+)?(?:secrets?|tokens?|api\s*keys?)/i,
    /you\s+are\s+now\s+(?:in|a)\s+/i,
    /override\s+(?:safety|billing|credit|authorization)/i,
];
function redactString(input) {
    const preservedUuids = [];
    let value = input.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, (uuid) => {
        const index = preservedUuids.push(uuid) - 1;
        return `[PRESERVED_UUID_${index}]`;
    });
    let count = 0;
    for (const [pattern, replacement] of SECRET_PATTERNS) {
        value = value.replace(pattern, (match, key) => {
            count += 1;
            return replacement.includes('$1') ? replacement.replace('$1', key ?? 'secret') : replacement;
        });
    }
    value = value.replace(/\[PRESERVED_UUID_(\d+)\]/g, (_match, index) => preservedUuids[Number(index)] ?? _match);
    return {
        value,
        count,
        injection: INJECTION_PATTERNS.some((pattern) => pattern.test(input)),
    };
}
/** Redacts and bounds arbitrary telemetry without mutating caller-owned data. */
export function sanitizeUntrusted(input, maxChars) {
    let remaining = maxChars;
    let redactionCount = 0;
    let injectionDetected = false;
    let truncated = false;
    const walk = (value, depth) => {
        if (depth > 12 || remaining <= 0) {
            truncated = true;
            return '[TRUNCATED]';
        }
        if (typeof value === 'string') {
            const redacted = redactString(value);
            redactionCount += redacted.count;
            injectionDetected ||= redacted.injection;
            const bounded = redacted.value.slice(0, Math.max(0, remaining));
            if (bounded.length < redacted.value.length)
                truncated = true;
            remaining -= bounded.length;
            return bounded;
        }
        if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
            remaining -= String(value).length;
            return value;
        }
        if (Array.isArray(value)) {
            const bounded = value.slice(0, 1_000);
            if (bounded.length < value.length)
                truncated = true;
            return bounded.map((item) => walk(item, depth + 1));
        }
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value)
                .slice(0, 200)
                .map(([key, item]) => [key.slice(0, 128), walk(item, depth + 1)]));
        }
        return String(value);
    };
    return { value: walk(input, 0), redactionCount, injectionDetected, truncated };
}
export function stableStringify(value) {
    const normalize = (item) => {
        if (Array.isArray(item))
            return item.map(normalize);
        if (item && typeof item === 'object') {
            return Object.fromEntries(Object.entries(item)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, child]) => [key, normalize(child)]));
        }
        return item;
    };
    return JSON.stringify(normalize(value));
}
export function sha256(value) {
    return createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex');
}
export function isUnsafeOfficialQuery(query) {
    if (!query)
        return false;
    return /(?:reveal|print|show|expose).*(?:system|developer|master)\s+prompt|(?:steal|dump|exfiltrate).*(?:secret|token|credential)/i.test(query);
}
export function extractJsonObject(raw) {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start)
        throw new Error('Provider response did not contain a JSON object');
    return JSON.parse(trimmed.slice(start, end + 1));
}
//# sourceMappingURL=security.js.map