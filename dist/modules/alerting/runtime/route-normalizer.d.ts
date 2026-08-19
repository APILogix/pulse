/**
 * Route normalizer and high-cardinality sanitizer for alerting fingerprints.
 *
 * Normalizes dynamic path segments (UUIDs, integers, hex ObjectIDs, prefixed IDs)
 * into stable parameter placeholders (e.g. `/users/123` -> `/users/:id`,
 * `/org/org_abc123/projects/456` -> `/org/:id/projects/:id`) to prevent Redis
 * key cardinality explosion while preserving semantic route grouping.
 */
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
export declare function normalizeRoute(rawRoute: string | null | undefined): string;
//# sourceMappingURL=route-normalizer.d.ts.map