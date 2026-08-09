/**
 * Error event detail assembler.
 *
 * Transforms a raw `events_errors` row + lightweight correlated data into the
 * structured payload the frontend expects for the error detail page. The
 * backend does NOT expose the raw payload by default; it extracts only the
 * well-known fields and leaves internal payload fields behind.
 */
import { assertErrorPublicId, isErrorPublicId } from './public-id.js';

export { assertErrorPublicId, isErrorPublicId } from './public-id.js';

export interface ErrorDetailResponse {
  id: string;
  publicId: string;
  occurredAt: string | null;
  error: {
    name: string | null;
    message: string | null;
    severity: string | null;
    handled: boolean | null;
    mechanism: string | null;
  };
  http: {
    method: string | null;
    route: string | null;
    url: string | null;
    statusCode: number | null;
    statusText: string | null;
  };
  environment: string | null;
  project: {
    name: string | null;
    slug: string | null;
  };
  service: string | null;
  server: {
    name: string | null;
  };
  release: string | null;
  sdk: {
    name: string | null;
    version: string | null;
  };
  trace: {
    publicId: string | null;
    traceId: string | null;
  };
  errorGroup: {
    publicId: string | null;
  };
  request: {
    publicId: string | null;
  };
  debugging: {
    stackFrames: unknown;
    breadcrumbs: unknown;
  };
  context: Record<string, unknown>;
  tags: Record<string, unknown>;
  extra: Record<string, unknown>;
  metadata: Record<string, unknown>;
  aiResponse: unknown;
  related: {
    errorGroup: { publicId: string | null };
    trace: { publicId: string | null };
    request: { publicId: string | null };
    logs: { count: number };
  };
}

export interface ErrorRelatedInput {
  errorGroupPublicId: string | null;
  tracePublicId: string | null;
  requestPublicId: string | null;
  logsCount: number;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

function asIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to empty object
    }
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }
  return [];
}

/**
 * Assemble the structured error detail response from a raw `events_errors` row
 * and the lightweight correlated data fetched by the service.
 *
 * The raw row is expected to be the output of `fetchRawById` for the `errors`
 * resource, so keys are the physical column names from the Log DB
 * (e.g. `public_id`, `error_name`, `trace_id`, ...).
 */
export function assembleErrorDetail(
  raw: Record<string, unknown>,
  related: ErrorRelatedInput,
): ErrorDetailResponse {
  const errorGroupPublicId =
    related.errorGroupPublicId ??
    asString(raw.error_group_public_id) ??
    asString(raw.errorGroupPublicId) ??
    null;

  const tracePublicId =
    related.tracePublicId ??
    asString(raw.trace_public_id) ??
    asString(raw.tracePublicId) ??
    null;

  const requestPublicId =
    related.requestPublicId ??
    asString(raw.request_public_id) ??
    asString(raw.requestPublicId) ??
    null;

  return {
    id: asString(raw.id) ?? '',
    publicId: asString(raw.public_id) ?? 'unknown',
    occurredAt: asIsoTimestamp(raw.occurred_at),
    error: {
      name: asString(raw.error_name),
      message: asString(raw.message),
      severity: asString(raw.severity),
      handled: asBoolean(raw.handled) ?? null,
      mechanism: asString(raw.mechanism),
    },
    http: {
      method: asString(raw.method),
      route: asString(raw.route),
      url: asString(raw.url),
      statusCode: asNumber(raw.status_code),
      statusText: asString(raw.status_text),
    },
    environment: asString(raw.environment),
    project: {
      name: asString(raw.projectName ?? raw.project_name),
      slug: asString(raw.projectSlug ?? raw.project_slug ?? raw.project),
    },
    service: asString(raw.service),
    server: {
      name: asString(raw.server_name),
    },
    release: asString(raw.release),
    sdk: {
      name: asString(raw.sdk_name),
      version: asString(raw.sdk_version),
    },
    trace: {
      publicId: tracePublicId,
      traceId: asString(raw.trace_id),
    },
    errorGroup: {
      publicId: errorGroupPublicId,
    },
    request: {
      publicId: requestPublicId,
    },
    debugging: {
      stackFrames: asArray(raw.stack_frames),
      breadcrumbs: asArray(raw.breadcrumbs),
    },
    context: asRecord(raw.context),
    tags: asRecord(raw.tags),
    extra: asRecord(raw.extra),
    metadata: asRecord(raw.metadata),
    aiResponse: raw.ai_response ?? null,
    related: {
      errorGroup: { publicId: errorGroupPublicId },
      trace: { publicId: tracePublicId },
      request: { publicId: requestPublicId },
      logs: { count: related.logsCount },
    },
  };
}
