/**
 /**
 * Error Group canonical item assembler.
 *
 * Transforms raw `error_groups` logdb rows into the exact structured contract
 * expected by the frontend Error Groups table and detail pages.
 */

export interface ErrorGroupCanonicalItem {
  id: string;
  publicId: string;
  status: string;
  occurrences: {
    count: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  };
  severity: {
    highest: string;
    latest: string;
  };
  regression: {
    count: number;
    lastRegressedAt: string | null;
  };
  release: {
    latest: string | null;
    resolvedIn: string | null;
  };
  latestEvent: {
    publicId: string | null;
    errorName: string;
    message: string;
    statusCode: number | null;
    trace: {
      publicId: string | null;
      traceId: string | null;
    };
  };
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export function assembleErrorGroupItem(
  raw: Record<string, unknown>,
  tracePublicIdMap?: Map<string, string>,
  eventPublicIdMap?: Map<string, string>,
): ErrorGroupCanonicalItem {
  const id = asString(raw.id) ?? '';
  const publicId = asString(raw.public_id) ?? asString(raw.publicId) ?? 'ISS-000000000';
  const status = (asString(raw.status) ?? 'OPEN').toUpperCase();

  const count = asNumber(raw.occurrence_count ?? raw.occurrenceCount ?? 1);
  const firstSeenAt = asIsoTimestamp(raw.first_seen_at ?? raw.firstSeenAt ?? raw.firstSeen);
  const lastSeenAt = asIsoTimestamp(raw.last_seen_at ?? raw.lastSeenAt ?? raw.lastSeen);

  const highestSeverity = (asString(raw.highest_severity) ?? asString(raw.highestSeverity) ?? 'error').toLowerCase();
  const latestSeverity = (asString(raw.latest_severity) ?? asString(raw.latestSeverity) ?? 'error').toLowerCase();

  const regressionCount = asNumber(raw.regression_count ?? raw.regressionCount ?? 0);
  const lastRegressedAt = asIsoTimestamp(raw.last_regressed_at ?? raw.lastRegressedAt);

  const latestRelease = asString(raw.latest_release) ?? asString(raw.latestRelease) ?? null;
  const resolvedIn = asString(raw.resolved_release) ?? asString(raw.resolvedRelease) ?? asString(raw.resolvedIn) ?? null;

  const rawLatestEventPublicId =
    asString(raw.latest_event_public_id) ??
    asString(raw.latestEventPublicId) ??
    asString(raw.last_event_public_id) ??
    asString(raw.lastEventPublicId);

  const latestEventPublicId =
    rawLatestEventPublicId ?? (eventPublicIdMap?.get(id) || eventPublicIdMap?.get(publicId) || null);

  const errorName = asString(raw.last_error_name) ?? asString(raw.lastErrorName) ?? 'Error';
  const message = asString(raw.last_error_message) ?? asString(raw.lastErrorMessage) ?? '';
  const statusCode = raw.last_status_code !== undefined && raw.last_status_code !== null
    ? asNumber(raw.last_status_code)
    : raw.lastStatusCode !== undefined && raw.lastStatusCode !== null
      ? asNumber(raw.lastStatusCode)
      : null;

  const traceId = asString(raw.last_trace_id) ?? asString(raw.lastTraceId) ?? null;
  const rawTracePublicId = asString(raw.last_trace_public_id) ?? asString(raw.lastTracePublicId) ?? null;
  const tracePublicId = rawTracePublicId ?? (traceId ? tracePublicIdMap?.get(traceId) ?? null : null);

  return {
    id,
    publicId,
    status,
    occurrences: {
      count,
      firstSeenAt,
      lastSeenAt,
    },
    severity: {
      highest: highestSeverity,
      latest: latestSeverity,
    },
    regression: {
      count: regressionCount,
      lastRegressedAt,
    },
    release: {
      latest: latestRelease,
      resolvedIn,
    },
    latestEvent: {
      publicId: latestEventPublicId,
      errorName,
      message,
      statusCode,
      trace: {
        publicId: tracePublicId,
        traceId,
      },
    },
  };
}
