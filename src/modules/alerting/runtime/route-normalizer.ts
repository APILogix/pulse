/**
 * Route normalizer and high-cardinality sanitizer for alerting fingerprints.
 *
 * Normalizes dynamic path segments (UUIDs, integers, hex ObjectIDs, prefixed IDs)
 * into stable parameter placeholders (e.g. `/users/123` -> `/users/:id`,
 * `/org/org_abc123/projects/456` -> `/org/:id/projects/:id`) to prevent Redis
 * key cardinality explosion while preserving semantic route grouping.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_REGEX = /^\d+$/;
const HEX_OBJECT_ID_REGEX = /^[0-9a-f]{24}$/i;
const PREFIXED_ID_REGEX = /^[a-z]{2,8}_[0-9a-zA-Z]{6,36}$/i;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROUTE_LENGTH = 128;

/**
 * Normalizes a dynamic route or endpoint path to a bounded, canonical template.
 *
 * Examples:
 * - `/users/123` -> `/users/:id`
 * - `/users/123/posts/456` -> `/users/:id/posts/:id`
 * - `/projects/123e4567-e89b-12d3-a456-426614174000/details` -> `/projects/:id/details`
 * - `/org/org_8899aabb/members` -> `/org/:id/members`
 * - `https://api.example.com/v1/users/456?filter=true#top` -> `/v1/users/:id`
 */
export function normalizeRoute(rawRoute: string | null | undefined): string {
  if (!rawRoute || typeof rawRoute !== 'string') {
    return '/';
  }

  let route = rawRoute.trim();
  if (!route) {
    return '/';
  }

  // 1. Strip protocol and domain if a full URL was provided
  try {
    if (route.startsWith('http://') || route.startsWith('https://')) {
      const parsed = new URL(route);
      route = parsed.pathname;
    }
  } catch {
    // If URL parsing fails, strip manually
    route = route.replace(/^[a-z]+:\/\/[^/]+/i, '');
  }

  // 2. Strip query strings and hash fragments
  const queryIdx = route.indexOf('?');
  if (queryIdx !== -1) {
    route = route.slice(0, queryIdx);
  }
  const hashIdx = route.indexOf('#');
  if (hashIdx !== -1) {
    route = route.slice(0, hashIdx);
  }

  // 3. Trim and collapse duplicate slashes
  route = route.replace(/\/+/g, '/').trim();
  if (route.endsWith('/') && route.length > 1) {
    route = route.slice(0, -1);
  }

  if (!route.startsWith('/')) {
    route = `/${route}`;
  }

  if (route === '/') {
    return '/';
  }

  // 4. Normalize path segments
  const segments = route.split('/').filter(Boolean);
  const normalizedSegments = segments.map((segment) => {
    // Check if segment is a dynamic parameter or ID
    if (UUID_REGEX.test(segment)) {
      return ':id';
    }
    if (NUMERIC_REGEX.test(segment)) {
      return ':id';
    }
    if (HEX_OBJECT_ID_REGEX.test(segment)) {
      return ':id';
    }
    if (PREFIXED_ID_REGEX.test(segment)) {
      return ':id';
    }
    if (ISO_DATE_REGEX.test(segment)) {
      return ':date';
    }

    // Preserve static route segments (lowercase for consistency)
    return segment.toLowerCase();
  });

  const normalized = `/${normalizedSegments.join('/')}`;

  // Bounded length protection
  if (normalized.length > MAX_ROUTE_LENGTH) {
    return normalized.slice(0, MAX_ROUTE_LENGTH);
  }

  return normalized;
}
