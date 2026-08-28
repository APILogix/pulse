/**
 * Workload profile and payload generation for the HTTP-level ingestion
 * benchmark generator.
 *
 * Every payload shape below is built to satisfy the ACTUAL Zod schemas in
 * `src/modules/ingestion/pipeline/event-normalizer.ts`, so events are
 * realistic and pass worker-side normalization rather than being silently
 * routed to the DLQ as malformed input (which would make the benchmark
 * measure the reject path instead of ingestion capacity). Field names/limits
 * below are cited against that file's line-level schema definitions where
 * relevant.
 */
import { randomUUID } from 'crypto';

export type SdkEventType =
  | 'error' | 'message' | 'request' | 'span' | 'trace'
  | 'metric' | 'log' | 'profile' | 'cron_checkin' | 'replay';

export type WorkloadProfileName =
  | 'request-heavy' | 'log-heavy' | 'error-heavy' | 'trace-heavy' | 'mixed'
  | 'duplicate-heavy' | 'large-payload' | 'multi-tenant' | 'worst-case';

export interface ProfileSpec {
  name: WorkloadProfileName;
  /** Relative weights across SDK event types this profile emits. */
  typeWeights: Partial<Record<SdkEventType, number>>;
  /** Fraction (0-1) of events that reuse a previously seen eventId (duplicate path). */
  duplicateRatio: number;
  /** Payload size class, used to pick string-field lengths. */
  payloadSize: 'small' | 'normal' | 'large';
  /** Number of span children for trace payloads (ignored by non-trace types). */
  traceSpanCount: number;
  description: string;
}

const PROFILES: Record<WorkloadProfileName, ProfileSpec> = {
  'request-heavy': {
    name: 'request-heavy',
    typeWeights: { request: 90, error: 5, log: 5 },
    duplicateRatio: 0,
    payloadSize: 'normal',
    traceSpanCount: 0,
    description: 'Mostly HTTP request/response telemetry, realistic status/latency mix.',
  },
  'log-heavy': {
    name: 'log-heavy',
    typeWeights: { log: 90, message: 5, request: 5 },
    duplicateRatio: 0,
    payloadSize: 'normal',
    traceSpanCount: 0,
    description: 'Mostly application log records at realistic sizes.',
  },
  'error-heavy': {
    name: 'error-heavy',
    typeWeights: { error: 85, request: 10, log: 5 },
    duplicateRatio: 0.15,
    payloadSize: 'normal',
    traceSpanCount: 0,
    description: 'Errors with realistic fingerprints and a moderate duplicate rate ' +
      '(same fingerprint recurring, as real crash loops do), to exercise error grouping.',
  },
  'trace-heavy': {
    name: 'trace-heavy',
    typeWeights: { trace: 70, span: 20, request: 10 },
    duplicateRatio: 0,
    payloadSize: 'normal',
    traceSpanCount: 12,
    description: 'Traces and standalone spans; exercises trace expansion cost.',
  },
  mixed: {
    name: 'mixed',
    typeWeights: {
      request: 30, log: 25, error: 10, trace: 10, span: 10, metric: 8, message: 5, cron_checkin: 2,
    },
    duplicateRatio: 0.02,
    payloadSize: 'normal',
    traceSpanCount: 6,
    description: 'Realistic combination across all commonly-emitted SDK event types.',
  },
  'duplicate-heavy': {
    name: 'duplicate-heavy',
    typeWeights: { log: 50, request: 30, error: 20 },
    duplicateRatio: 0.7,
    payloadSize: 'normal',
    traceSpanCount: 0,
    description: 'High percentage of duplicate events (same eventId resent), to measure ' +
      'idempotency/duplicate-path cost. BLOCKED for log events until the events_logs unique ' +
      'guard (migration 030) is confirmed deployed on the target — see safety gate.',
  },
  'large-payload': {
    name: 'large-payload',
    typeWeights: { error: 40, request: 30, log: 30 },
    duplicateRatio: 0,
    payloadSize: 'large',
    traceSpanCount: 0,
    description: 'Large but schema-valid payloads (near the 256 KiB per-event cap), never ' +
      'exceeding MAX_EVENT_BYTES so events are accepted rather than rejected as oversized.',
  },
  'multi-tenant': {
    name: 'multi-tenant',
    typeWeights: { request: 40, log: 30, error: 20, trace: 10 },
    duplicateRatio: 0,
    payloadSize: 'normal',
    traceSpanCount: 4,
    description: 'Same event mix as "mixed", intended to be run with --tenants > 1 so the ' +
      'generator addresses multiple independent benchmark-tagged API keys concurrently.',
  },
  'worst-case': {
    name: 'worst-case',
    typeWeights: { trace: 30, error: 25, span: 20, request: 15, log: 10 },
    duplicateRatio: 0.2,
    payloadSize: 'large',
    traceSpanCount: 20,
    description: 'Combines expensive legitimate workloads: large payloads + traces/spans + ' +
      'errors + duplicates + (when run with --tenants > 1) multiple tenants. Every component ' +
      'individually validates against the real schemas; nothing here is malformed input.',
  },
};

export function getProfile(name: WorkloadProfileName): ProfileSpec {
  const profile = PROFILES[name];
  if (!profile) throw new Error(`Unknown workload profile ${JSON.stringify(name)}`);
  return profile;
}

export function listProfiles(): ProfileSpec[] {
  return Object.values(PROFILES);
}

// ── Weighted type selection ─────────────────────────────────────────────────

export function pickType(spec: ProfileSpec, rng: () => number = Math.random): SdkEventType {
  const entries = Object.entries(spec.typeWeights) as Array<[SdkEventType, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [type, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return type;
  }
  return entries[0]![0];
}

// ── Field-length helpers per payload size class ─────────────────────────────

function sizeToLen(size: ProfileSpec['payloadSize']): { message: number; context: number; stack: number } {
  if (size === 'small') return { message: 64, context: 2, stack: 2 };
  if (size === 'large') return { message: 3800, context: 40, stack: 60 }; // stays under 256 KiB/event cap
  return { message: 300, context: 8, stack: 8 };
}

function randomString(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
  let out = '';
  while (out.length < len) out += chars[Math.floor(Math.random() * chars.length)];
  return out.slice(0, len);
}

function contextObject(keys: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < keys; i += 1) out[`field_${i}`] = randomString(24);
  return out;
}

// ── Duplicate-key tracking ──────────────────────────────────────────────────

/**
 * Tracks previously-emitted eventIds per type so a "duplicate" event reuses a
 * real prior id rather than a fabricated one that never existed. This mirrors
 * how a real SDK retry/redelivery would look: identical `eventId`.
 */
export class DuplicateTracker {
  private readonly seenByType = new Map<SdkEventType, string[]>();
  private readonly maxTracked = 5_000;

  record(type: SdkEventType, eventId: string): void {
    const list = this.seenByType.get(type) ?? [];
    list.push(eventId);
    if (list.length > this.maxTracked) list.shift();
    this.seenByType.set(type, list);
  }

  pickPrior(type: SdkEventType): string | null {
    const list = this.seenByType.get(type);
    if (!list || list.length === 0) return null;
    return list[Math.floor(Math.random() * list.length)] ?? null;
  }
}

// ── Per-type payload builders ───────────────────────────────────────────────

function buildSpanTree(depth: number, spanCount: number, traceId: string): unknown {
  let remaining = spanCount;
  function makeSpan(currentDepth: number): { spanId: string; name: string; startTime: number; children: unknown[] } | null {
    if (remaining <= 0) return null;
    remaining -= 1;
    const span = {
      spanId: randomUUID().slice(0, 16),
      name: `span.${currentDepth}.${randomString(8)}`,
      startTime: Date.now(),
      children: [] as unknown[],
    };
    if (currentDepth < depth && remaining > 0) {
      const childCount = Math.min(remaining, 2);
      for (let i = 0; i < childCount; i += 1) {
        const child = makeSpan(currentDepth + 1);
        if (child) span.children.push(child);
      }
    }
    return span;
  }
  return makeSpan(0) ?? { spanId: randomUUID().slice(0, 16), name: 'root', startTime: Date.now(), children: [] };
}

export function buildEvent(
  type: SdkEventType,
  spec: ProfileSpec,
  opts: { duplicateTracker: DuplicateTracker; forceDuplicate: boolean },
): { event: Record<string, unknown>; eventId: string; wasDuplicate: boolean } {
  const lens = sizeToLen(spec.payloadSize);
  let eventId = randomUUID();
  let wasDuplicate = false;

  if (opts.forceDuplicate) {
    const prior = opts.duplicateTracker.pickPrior(type);
    if (prior) {
      eventId = prior;
      wasDuplicate = true;
    }
  }
  if (!wasDuplicate) opts.duplicateTracker.record(type, eventId);

  const now = Date.now();
  const base = { eventId, timestamp: now };

  switch (type) {
    case 'error':
      return {
        eventId,
        wasDuplicate,
        event: {
          type: 'error',
          ...base,
          message: randomString(Math.min(lens.message, 4096)), // LIMITS.maxMessageLen
          name: 'BenchmarkError',
          stack: Array.from({ length: Math.min(lens.stack, 200) }, (_, i) => ({ frame: i, fn: randomString(24) })),
          fingerprint: wasDuplicate ? `bench-fp-${eventId.slice(0, 8)}` : `bench-fp-${randomUUID().slice(0, 8)}`,
          severity: 'error',
          statusCode: 500,
          handled: true,
          method: 'GET',
          route: '/bench/route',
          url: 'https://bench.invalid/route',
          context: contextObject(lens.context),
        },
      };
    case 'message':
      return {
        eventId,
        wasDuplicate,
        event: {
          type: 'message',
          ...base,
          message: randomString(lens.message),
          severity: 'info',
          attributes: contextObject(lens.context),
        },
      };
    case 'request':
      return {
        eventId,
        wasDuplicate,
        event: {
          type: 'request',
          ...base,
          requestId: eventId,
          url: 'https://bench.invalid/api/resource',
          route: '/api/resource',
          method: 'GET',
          statusCode: 200,
          latency: Math.random() * 200,
          bodySize: lens.message,
          responseSize: lens.message,
          service: 'bench-service',
          extra: contextObject(lens.context),
        },
      };
    case 'span':
      return {
        eventId,
        wasDuplicate,
        event: {
          type: 'span',
          ...base,
          spanId: eventId.slice(0, 16),
          traceId: randomUUID().slice(0, 16),
          name: 'bench.span',
          kind: 'internal',
          startTime: now,
          endTime: now + 5,
          duration: 5,
          status: 'ok',
          attributes: contextObject(lens.context),
        },
      };
    case 'trace': {
      const traceId = randomUUID().slice(0, 16);
      return {
        eventId,
        wasDuplicate,
        event: {
          type: 'trace',
          ...base,
          traceId,
          rootSpan: buildSpanTree(4, Math.max(1, spec.traceSpanCount), traceId),
          spanCount: Math.max(1, spec.traceSpanCount),
          totalDuration: 42,
        },
      };
    }
    case 'metric':
      return {
        eventId,
        wasDuplicate,
        event: {
          type: 'metric',
          ...base,
          metricName: 'bench.metric',
          metricType: 'counter',
          value: Math.random() * 100,
          unit: 'count',
          tags: contextObject(Math.min(lens.context, 10)),
        },
      };
    case 'log':
      return {
        eventId,
        wasDuplicate,
        event: {
          type: 'log',
          ...base,
          level: 'info',
          message: randomString(lens.message),
          logSource: 'application',
          logCategory: 'application',
          attributes: contextObject(lens.context),
        },
      };
    case 'profile':
      return {
        eventId,
        wasDuplicate,
        event: {
          type: 'profile',
          ...base,
          profileType: 'cpu',
          startTime: now,
          endTime: now + 1000,
          duration: 1000,
          profile: { samples: Array.from({ length: 10 }, () => randomString(16)) },
        },
      };
    case 'cron_checkin':
      return {
        eventId,
        wasDuplicate,
        event: {
          type: 'cron_checkin',
          ...base,
          monitorSlug: 'bench-cron',
          status: 'ok',
          duration: 12,
        },
      };
    case 'replay':
      return {
        eventId,
        wasDuplicate,
        event: {
          type: 'replay',
          ...base,
        },
      };
    default:
      throw new Error(`Unsupported SdkEventType ${String(type)}`);
  }
}

/** Generate one batch of `count` events for `type` under `profile`. */
export function buildBatch(
  type: SdkEventType,
  count: number,
  spec: ProfileSpec,
  duplicateTracker: DuplicateTracker,
): { events: Record<string, unknown>[]; duplicateCount: number } {
  const events: Record<string, unknown>[] = [];
  let duplicateCount = 0;
  for (let i = 0; i < count; i += 1) {
    const forceDuplicate = Math.random() < spec.duplicateRatio;
    const { event, wasDuplicate } = buildEvent(type, spec, { duplicateTracker, forceDuplicate });
    if (wasDuplicate) duplicateCount += 1;
    events.push(event);
  }
  return { events, duplicateCount };
}
