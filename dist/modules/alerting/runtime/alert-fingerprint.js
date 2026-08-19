import { createHash } from 'node:crypto';
import { normalizeRoute } from './route-normalizer.js';
export const ALLOWED_GROUP_DIMENSIONS = [
    'route',
    'endpoint',
    'service',
    'environment',
    'status_code',
    'statusCode',
    'method',
    'severity',
    'host',
];
const MAX_GROUP_DIMENSIONS = 5;
/**
 * Extracts and parses requested grouping dimensions from rule configuration.
 */
export function resolveGroupingDimensions(input) {
    const dimensions = new Set();
    // 1. Explicit groupBy array in rule metadata/labels/policy
    if (Array.isArray(input.groupBy)) {
        for (const d of input.groupBy) {
            if (typeof d === 'string')
                dimensions.add(d.trim().toLowerCase());
        }
    }
    // 2. Comma-separated or template string in grouping_key_template
    if (input.groupingKeyTemplate && typeof input.groupingKeyTemplate === 'string') {
        const matches = input.groupingKeyTemplate.match(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g);
        if (matches) {
            for (const m of matches) {
                const cleaned = m.replace(/[\{\}\s]/g, '').toLowerCase();
                dimensions.add(cleaned);
            }
        }
        else {
            // Split by commas or colons
            const parts = input.groupingKeyTemplate.split(/[,:]/);
            for (const p of parts) {
                const cleaned = p.trim().toLowerCase();
                if (cleaned)
                    dimensions.add(cleaned);
            }
        }
    }
    // 3. If rule scope explicitly defines an endpoint or service and grouping is active
    if (input.scope?.endpoint || input.scope?.service) {
        if (input.scope.endpoint)
            dimensions.add('route');
        if (input.scope.service)
            dimensions.add('service');
    }
    // 4. If grouping is enabled but no dimensions specified, default to route for latency/request rules
    if (input.groupingEnabled && dimensions.size === 0) {
        dimensions.add('route');
    }
    // Filter against allowed whitelist and enforce max bounded dimensions
    const allowed = Array.from(dimensions)
        .filter((d) => ALLOWED_GROUP_DIMENSIONS.includes(d))
        .slice(0, MAX_GROUP_DIMENSIONS);
    return allowed;
}
/**
 * Computes a deterministic alert fingerprint with normalized grouping dimensions.
 */
export function computeAlertFingerprint(input) {
    const org = (input.organizationId || 'unknown_org').trim().toLowerCase();
    const proj = (input.projectId || 'org').trim();
    const env = (input.environment || input.scope?.environment || 'all').trim().toLowerCase();
    const rule = (input.ruleId || 'norule').trim();
    const policy = (input.policyId || rule).trim();
    const groupDimensions = resolveGroupingDimensions(input);
    const normalizedDimensions = {};
    const payloadValues = (input.payload?.values ?? {});
    const payloadEvidence = (input.payload?.evidence ?? input.evidence ?? {});
    const payloadLabels = (input.payload?.labels ?? input.labels ?? {});
    const requests = (payloadValues.requests ?? {});
    for (const dim of groupDimensions) {
        switch (dim) {
            case 'route':
            case 'endpoint': {
                const rawRoute = (input.scope?.endpoint ??
                    input.dimension ??
                    requests.route ??
                    requests.endpoint ??
                    payloadLabels.route ??
                    payloadLabels.endpoint ??
                    payloadEvidence.route ??
                    payloadEvidence.endpoint ??
                    '/');
                normalizedDimensions.route = normalizeRoute(String(rawRoute));
                break;
            }
            case 'service': {
                const rawService = (input.scope?.service ??
                    payloadLabels.service ??
                    payloadEvidence.service ??
                    'default');
                normalizedDimensions.service = String(rawService).trim().toLowerCase().slice(0, 64);
                break;
            }
            case 'environment': {
                normalizedDimensions.environment = env;
                break;
            }
            case 'status_code':
            case 'statusCode': {
                const rawCode = requests.status_code ?? requests.statusCode ?? payloadEvidence.status_code;
                if (rawCode !== undefined && rawCode !== null) {
                    const parsed = Number(rawCode);
                    if (Number.isFinite(parsed)) {
                        normalizedDimensions.status_code = String(Math.floor(parsed));
                    }
                }
                break;
            }
            case 'method': {
                const rawMethod = requests.method ?? payloadEvidence.method ?? payloadLabels.method;
                if (rawMethod) {
                    normalizedDimensions.method = String(rawMethod).trim().toUpperCase().slice(0, 16);
                }
                break;
            }
            case 'severity': {
                const sev = input.severity ?? 'warning';
                normalizedDimensions.severity = String(sev).trim().toLowerCase();
                break;
            }
            case 'host': {
                const rawHost = payloadLabels.host ?? payloadEvidence.host;
                if (rawHost) {
                    normalizedDimensions.host = String(rawHost).trim().toLowerCase().slice(0, 64);
                }
                break;
            }
        }
    }
    // If no dimensions were extracted or applicable, this is a global rule scope
    const dimensionPairs = Object.entries(normalizedDimensions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`);
    const dimensionKey = dimensionPairs.length > 0 ? dimensionPairs.join('|') : 'global';
    // Deterministic fingerprint material
    const material = `${org}:${proj}:${env}:${rule}:${policy}:${dimensionKey}`;
    const fingerprint = createHash('sha256').update(material).digest('hex');
    return {
        fingerprint,
        dimensionKey,
        normalizedDimensions,
    };
}
//# sourceMappingURL=alert-fingerprint.js.map