/**
 * Correlation Engine (Phase 16).
 *
 * From a seed event, the backend assembles ONE correlated bundle spanning
 * requests, errors, logs, traces, spans, metrics, profiles, and crons. The
 * frontend performs zero joins. Correlation keys, in priority order, are
 * `trace_id` (present on every canonical table), then `request_id`. Results are
 * bounded by a time window around the seed and a per-type row cap.
 */
import type { QueryContext } from '../query-engine/index.js';
import type { ObservabilityRepository, CorrelationColumn } from '../repository.js';
import { explorerRegistry } from '../resources/index.js';

/** Related-event resources correlated for a detail view. */
const RELATED_RESOURCES = ['requests', 'errors', 'logs', 'spans', 'metrics', 'profiles', 'crons'] as const;

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_TYPE = 100;

export interface CorrelationKeys {
  traceId: string | null;
  tracePublicId?: string | null;
  requestId: string | null;
  spanId: string | null;
  sessionId: string | null;
  userId: string | null;
}

export interface CorrelationBundle {
  keys: CorrelationKeys;
  trace: Record<string, unknown> | null;
  spanTree: unknown;
  spans: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
  relatedErrors: Array<Record<string, unknown>>;
  relatedRequests: Array<Record<string, unknown>>;
  metrics: Array<Record<string, unknown>>;
  profiles: Array<Record<string, unknown>>;
  crons: Array<Record<string, unknown>>;
  counts: Record<string, number>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function seedTime(seedRow: Record<string, unknown>): Date {
  const raw = seedRow.timestamp ?? seedRow.occurred_at;
  const date = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export class CorrelationEngine {
  constructor(private readonly repository: ObservabilityRepository) {}

  extractKeys(seedRow: Record<string, unknown>): CorrelationKeys {
    return {
      traceId: asString(seedRow.trace_id) ?? asString(seedRow.traceId),
      requestId: asString(seedRow.request_id) ?? asString(seedRow.requestId),
      spanId: asString(seedRow.span_id) ?? asString(seedRow.spanId),
      sessionId: asString(seedRow.session_id) ?? asString(seedRow.sessionId),
      userId: asString(seedRow.user_id) ?? asString(seedRow.userId),
    };
  }

  /**
   * Build the correlated bundle for a seed event. Fetches every related
   * resource in parallel using the strongest available key (trace, then
   * request), excluding the seed row itself.
   */
  async correlate(
    seedResourceName: string,
    ctx: QueryContext,
    seedRow: Record<string, unknown>,
    options?: { windowMs?: number },
  ): Promise<CorrelationBundle> {
    const keys = this.extractKeys(seedRow);
    const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
    const center = seedTime(seedRow);
    const from = new Date(center.getTime() - windowMs);
    const to = new Date(center.getTime() + windowMs);
    const seedId = asString(seedRow.id);

    // Resolve the correlation column + value once. trace_id is preferred
    // because every canonical event table carries it.
    const correlator = this.pickCorrelator(keys);

    const empty: Array<Record<string, unknown>> = [];
    if (!correlator) {
      return this.assemble(keys, null, empty, empty, empty, empty, empty, empty, empty);
    }

    const fetches = RELATED_RESOURCES.map(async (name) => {
      const resource = explorerRegistry.get(name);
      if (!resource) return { name, rows: empty };
      const rows = await this.repository.fetchCorrelated({
        resource,
        ctx,
        column: correlator.column,
        value: correlator.value,
        from,
        to,
        limit: MAX_PER_TYPE,
        ...(seedId && name === seedResourceName ? { excludeId: seedId } : {}),
      });
      return { name, rows };
    });

    const traceFetch = keys.traceId ? this.fetchTrace(ctx, keys.traceId, from, to) : Promise.resolve(null);
    const [results, trace] = await Promise.all([Promise.all(fetches), traceFetch]);

    const byName = new Map(results.map((r) => [r.name, r.rows]));
    return this.assemble(
      keys,
      trace,
      byName.get('spans') ?? empty,
      byName.get('logs') ?? empty,
      byName.get('errors') ?? empty,
      byName.get('requests') ?? empty,
      byName.get('metrics') ?? empty,
      byName.get('profiles') ?? empty,
      byName.get('crons') ?? empty,
    );
  }

  private pickCorrelator(keys: CorrelationKeys): { column: CorrelationColumn; value: string } | null {
    if (keys.traceId) return { column: 'trace_id', value: keys.traceId };
    if (keys.requestId) return { column: 'request_id', value: keys.requestId };
    if (keys.sessionId) return { column: 'session_id', value: keys.sessionId };
    return null;
  }

  private async fetchTrace(
    ctx: QueryContext,
    traceId: string,
    from: Date,
    to: Date,
  ): Promise<Record<string, unknown> | null> {
    const resource = explorerRegistry.get('traces');
    if (!resource) return null;
    const rows = await this.repository.fetchCorrelated({
      resource,
      ctx,
      column: 'trace_id',
      value: traceId,
      from,
      to,
      limit: 1,
    });
    return rows[0] ?? null;
  }

  private assemble(
    keys: CorrelationKeys,
    trace: Record<string, unknown> | null,
    spans: Array<Record<string, unknown>>,
    logs: Array<Record<string, unknown>>,
    relatedErrors: Array<Record<string, unknown>>,
    relatedRequests: Array<Record<string, unknown>>,
    metrics: Array<Record<string, unknown>>,
    profiles: Array<Record<string, unknown>>,
    crons: Array<Record<string, unknown>>,
  ): CorrelationBundle {
    const spanTree = trace ? (trace.spansTree ?? trace.spans_tree ?? null) : null;
    const tracePublicId = trace ? (asString(trace.publicId) ?? asString(trace.public_id)) : null;
    return {
      keys: {
        ...keys,
        ...(tracePublicId ? { tracePublicId } : {}),
      },
      trace,
      spanTree,
      spans,
      logs,
      relatedErrors,
      relatedRequests,
      metrics,
      profiles,
      crons,
      counts: {
        spans: spans.length,
        logs: logs.length,
        errors: relatedErrors.length,
        requests: relatedRequests.length,
        metrics: metrics.length,
        profiles: profiles.length,
        crons: crons.length,
      },
    };
  }
}
