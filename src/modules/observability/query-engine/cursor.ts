import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ExplorerQuery,
  QueryContext,
  SortDirection,
} from './types.js';
import type { ExplorerResource } from './field-registry.js';
import { QueryValidationError } from './errors.js';

const CURSOR_VERSION = 1;
const CURSOR_TTL_MS = 15 * 60 * 1000;
const TEST_CURSOR_SECRET = 'observability-cursor-test-secret';

export interface CursorPayload {
  /** Cursor format version. */
  v: 1;
  /** ISO timestamp of the boundary row's time column. */
  t: string;
  /** Boundary row id (second key of the pagination tuple). */
  id: string;
  /** Sort field used to create the cursor. */
  f: string;
  /** Sort direction used to create the cursor. */
  d: SortDirection;
  /** Registered resource name. */
  r: string;
  /** HMAC-bound query and tenant scope fingerprint. */
  s: string;
  /** Unix epoch expiry in milliseconds. */
  e: number;
}

export interface CursorExpectation {
  resource: string;
  sortField: string;
  sortDirection: SortDirection;
  scope: string;
}

function signingSecret(): string {
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === 'test') return TEST_CURSOR_SECRET;
  throw new Error('AUTH_TOKEN_SECRET must be configured for observability cursors');
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function stableSerialize(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function cursorScopeFingerprint(
  resource: ExplorerResource,
  ctx: QueryContext,
  query: ExplorerQuery,
): string {
  const scope = {
    resource: resource.name,
    organizationId: ctx.organizationId,
    projectId: ctx.projectId ?? null,
    allowedProjectIds: ctx.allowedProjectIds ? [...ctx.allowedProjectIds].sort() : null,
    environment: query.environment ?? ctx.environment ?? null,
    from: query.timeRange.from.toISOString(),
    to: query.timeRange.to.toISOString(),
    search: query.search ?? null,
    filters: query.filters,
    sort: query.sort,
  };
  return createHmac('sha256', signingSecret()).update(stableSerialize(scope)).digest('base64url');
}

export function createCursorPayload(
  resource: ExplorerResource,
  ctx: QueryContext,
  query: ExplorerQuery,
  boundary: { time: Date; id: string },
): CursorPayload {
  return {
    v: CURSOR_VERSION,
    t: boundary.time.toISOString(),
    id: boundary.id,
    f: query.sort.field,
    d: query.sort.direction,
    r: resource.name,
    s: cursorScopeFingerprint(resource, ctx, query),
    e: Date.now() + CURSOR_TTL_MS,
  };
}

export function encodeCursor(payload: CursorPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload, signingSecret())}`;
}

export function decodeCursor(cursor: string, expected?: CursorExpectation): CursorPayload {
  const parts = cursor.split('.');
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new QueryValidationError('Malformed pagination cursor');
  }

  const encodedPayload = parts[0]!;
  const encodedSignature = parts[1]!;
  const expectedSignature = sign(encodedPayload, signingSecret());
  const received = Buffer.from(encodedSignature, 'base64url');
  const expectedBuffer = Buffer.from(expectedSignature, 'base64url');
  if (received.length !== expectedBuffer.length || !timingSafeEqual(received, expectedBuffer)) {
    throw new QueryValidationError('Invalid pagination cursor');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new QueryValidationError('Malformed pagination cursor');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new QueryValidationError('Malformed pagination cursor');
  }
  const obj = parsed as Record<string, unknown>;
  const payload: CursorPayload = {
    v: obj.v as 1,
    t: obj.t as string,
    id: obj.id as string,
    f: obj.f as string,
    d: obj.d as SortDirection,
    r: obj.r as string,
    s: obj.s as string,
    e: obj.e as number,
  };

  if (
    payload.v !== CURSOR_VERSION
    || typeof payload.t !== 'string'
    || Number.isNaN(new Date(payload.t).getTime())
    || typeof payload.id !== 'string'
    || payload.id.length === 0
    || payload.id.length > 256
    || typeof payload.f !== 'string'
    || payload.f.length === 0
    || (payload.d !== 'asc' && payload.d !== 'desc')
    || typeof payload.r !== 'string'
    || payload.r.length === 0
    || typeof payload.s !== 'string'
    || payload.s.length === 0
    || typeof payload.e !== 'number'
    || !Number.isSafeInteger(payload.e)
    || payload.e <= Date.now()
  ) {
    throw new QueryValidationError('Malformed or expired pagination cursor');
  }

  if (expected) {
    if (
      payload.r !== expected.resource
      || payload.f !== expected.sortField
      || payload.d !== expected.sortDirection
      || payload.s !== expected.scope
    ) {
      throw new QueryValidationError('Pagination cursor does not match this query');
    }
  }

  return payload;
}
