import { computeConfigHash } from "./canonical.js";
import { classifyLeafPath } from "./editable-allowlist.js";
import { deepClone, enumerateLeafPaths, setAtPath } from "./traversal.js";
import { DEFAULT_SDK_RELEASE, ENTITLEMENT_KEYS, FEATURE_KEYS, GENERATOR_ID, INSTRUMENTATION_KEYS, KILLSWITCH_KEYS, ROUTE_INGEST_PATHS, ROUTE_KEYS, SAMPLING_SIGNALS, SCHEMA_VERSION, } from "./schema-v1.js";
export const PLATFORM_MANDATORY_SCRUB_HEADERS = [
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
];
export const PLATFORM_MANDATORY_SCRUB_FIELDS = [
    "password",
    "secret",
    "token",
    "apiKey",
    "authorization",
    "creditCard",
    "ssn",
    "access_token",
    "refresh_token",
    "client_secret",
];
const DEFAULT_FEATURES = new Set([
    "tracing",
    "requestCapture",
    "errors",
    "metrics",
    "logging",
]);
const DEFAULT_INSTRUMENTATION = new Set([
    "http",
    "https",
    "fetch",
    "fastify",
    "express",
    "eventEmitterPatch",
]);
const DEFAULT_ENTITLEMENTS = new Set([
    "customSpans",
    "customMetrics",
    "logging",
    "requestCapture",
    "tracing",
    "errors",
    "metrics",
]);
const ROUTE_DEFAULTS = {
    errors: {
        batchSize: 100,
        flushIntervalMs: 1000,
        timeoutMs: 5000,
        compression: "gzip",
        priority: "critical",
    },
    events: {
        batchSize: 100,
        flushIntervalMs: 2000,
        timeoutMs: 5000,
        compression: "gzip",
        priority: "high",
    },
    traces: {
        batchSize: 500,
        flushIntervalMs: 5000,
        timeoutMs: 5000,
        compression: "gzip",
        priority: "high",
    },
    spans: {
        batchSize: 500,
        flushIntervalMs: 5000,
        timeoutMs: 5000,
        compression: "gzip",
        priority: "normal",
    },
    requests: {
        batchSize: 500,
        flushIntervalMs: 5000,
        timeoutMs: 5000,
        compression: "gzip",
        priority: "high",
    },
    metrics: {
        batchSize: 1000,
        flushIntervalMs: 10000,
        timeoutMs: 5000,
        compression: "gzip",
        priority: "normal",
    },
    logs: {
        batchSize: 200,
        flushIntervalMs: 10000,
        timeoutMs: 5000,
        compression: "gzip",
        priority: "normal",
    },
    profiles: {
        batchSize: 5,
        flushIntervalMs: 30000,
        timeoutMs: 15000,
        compression: "gzip",
        priority: "low",
    },
    crons: {
        batchSize: 1,
        flushIntervalMs: 0,
        timeoutMs: 5000,
        compression: "none",
        priority: "high",
    },
    replays: {
        batchSize: 5,
        flushIntervalMs: 10000,
        timeoutMs: 30000,
        compression: "gzip",
        priority: "low",
    },
};
function schemaDefaults() {
    const features = Object.fromEntries(FEATURE_KEYS.map((key) => [key, DEFAULT_FEATURES.has(key)]));
    const killswitches = Object.fromEntries(KILLSWITCH_KEYS.map((key) => [key, false]));
    const instrumentation = Object.fromEntries(INSTRUMENTATION_KEYS.map((key) => [key, DEFAULT_INSTRUMENTATION.has(key)]));
    const entitlements = Object.fromEntries(ENTITLEMENT_KEYS.map((key) => [key, DEFAULT_ENTITLEMENTS.has(key)]));
    return {
        schemaVersion: SCHEMA_VERSION,
        sdk: { projectId: "", environment: "", release: DEFAULT_SDK_RELEASE },
        features,
        sampling: {
            errors: 1,
            traces: 1,
            spans: 1,
            requests: 1,
            metrics: 1,
            logs: 1,
            events: 1,
            messages: 1,
            profiles: 0.1,
            replays: 0.1,
            crons: 1,
            routes: {
                "/health": { requests: 0, traces: 0, spans: 0, metrics: 0, logs: 0 },
                "/favicon.ico": { traces: 0, requests: 0 },
            },
        },
        instrumentation,
        privacy: {
            capture: {
                headers: false,
                body: false,
                response: false,
                query: false,
                cookies: false,
            },
            scrubbing: {
                enabled: true,
                headers: [...PLATFORM_MANDATORY_SCRUB_HEADERS],
                fields: [...PLATFORM_MANDATORY_SCRUB_FIELDS],
            },
            piiDetection: {
                enabled: true,
                maskEmails: true,
                maskPhones: true,
                maskIPs: true,
            },
        },
        limits: {
            maxSpansPerTrace: 2000,
            maxSpanAttributes: 128,
            maxAttributeLength: 4096,
            maxPayloadSize: 1048576,
            maxQueueSize: 10000,
            maxMemoryMb: "auto",
            tenantGovernance: {
                enabled: false,
                maxTenantsTracked: 1000,
                quotaPerWindow: 10000,
                windowDurationMs: 60000,
                criticalReserve: 100,
            },
        },
        killswitches,
        transport: {
            retry: {
                enabled: true,
                maxRetries: 3,
                backoff: "exponential",
                baseDelayMs: 500,
            },
            queue: {
                overflowStrategy: "drop_oldest",
                maxSize: 10000,
                criticalReserve: 1000,
            },
            connections: {
                maxTotalConnections: 50,
                acquireTimeoutMs: 5000,
            },
            keepAlive: true,
            routes: {},
        },
        runtime: {
            configTtlSeconds: 300,
            staleWhileRevalidate: true,
        },
        meta: {
            generatedAt: "",
            generatedBy: GENERATOR_ID,
            configHash: "",
        },
        entitlements,
    };
}
function deriveRouteUrl(base, path) {
    return `${base.replace(/\/+$/, "")}${path}`;
}
function applyPlatformSafety(config, input) {
    config.sdk = {
        projectId: input.identity.projectId,
        environment: input.identity.environment,
        release: input.identity.release ?? DEFAULT_SDK_RELEASE,
    };
    const routes = {};
    for (const route of ROUTE_KEYS) {
        routes[route] = {
            url: deriveRouteUrl(input.topology.ingestBaseUrl, ROUTE_INGEST_PATHS[route]),
            ...ROUTE_DEFAULTS[route],
        };
    }
    config.transport.routes = routes;
    config.meta = {
        generatedAt: input.generatedAt,
        generatedBy: input.generatedBy ?? GENERATOR_ID,
        configHash: "",
    };
}
function applyIntent(config, intent) {
    const working = config;
    for (const leaf of enumerateLeafPaths(intent)) {
        if (leaf.segments.length === 0)
            continue;
        if (classifyLeafPath(leaf.segments).pathClass !== "editable")
            continue;
        setAtPath(working, leaf.segments, leaf.value);
    }
}
function enforceEnvelope(config, policy) {
    config.privacy.scrubbing.headers = dedupe([
        ...PLATFORM_MANDATORY_SCRUB_HEADERS,
        ...(policy?.mandatoryScrubHeaders ?? []),
        ...config.privacy.scrubbing.headers,
    ]);
    config.privacy.scrubbing.fields = dedupe([
        ...PLATFORM_MANDATORY_SCRUB_FIELDS,
        ...(policy?.mandatoryScrubFields ?? []),
        ...config.privacy.scrubbing.fields,
    ]);
    if (policy?.forcePiiEnabled)
        config.privacy.piiDetection.enabled = true;
    for (const feature of policy?.forceFeaturesOff ?? []) {
        config.features[feature] = false;
    }
    for (const killswitch of policy?.forceKillswitchesOn ?? []) {
        config.killswitches[killswitch] = true;
    }
    for (const signal of SAMPLING_SIGNALS) {
        const cap = policy?.maxSamplingRates?.[signal];
        if (typeof cap === "number" && config.sampling[signal] > cap) {
            config.sampling[signal] = cap;
        }
    }
    for (const key of Object.keys(policy?.limitCeilings ?? {})) {
        const ceiling = policy?.limitCeilings?.[key];
        const current = config.limits[key];
        if (typeof ceiling === "number" && typeof current === "number" && current > ceiling) {
            config.limits[key] = ceiling;
        }
    }
}
function dedupe(values) {
    return [...new Set(values)];
}
export function compile(input) {
    const config = schemaDefaults();
    applyPlatformSafety(config, input);
    applyIntent(config, deepClone(input.requestedIntent));
    enforceEnvelope(config, input.orgPolicy);
    config.meta.configHash = computeConfigHash(config);
    return config;
}
export function compileInitial(identity, topology, generatedAt, orgPolicy) {
    return compile({
        identity,
        topology,
        requestedIntent: {},
        generatedAt,
        ...(orgPolicy !== undefined ? { orgPolicy } : {}),
    });
}
//# sourceMappingURL=compiler.js.map