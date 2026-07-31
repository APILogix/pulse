/**
 * Route-contract tests for distributed SDK ingestion routing.
 *
 * Acceptance criteria verified here
 * (docs/distributed-ingestion-routing-master-prompt.md):
 *   - "SDK config advertises only routes that exist on the backend."
 *     Every path in ROUTE_INGEST_PATHS must have a matching backend POST route.
 *   - "Each event type has a dedicated POST route."
 *
 * This suite is intentionally dependency-light: it imports only the backend
 * route table, the schema-v1 route constants, and the SDK event-type list, so
 * it needs no environment variables, database, or queue runtime.
 */
import { describe, expect, it } from 'vitest';

import {
  TYPED_INGEST_ROUTES,
  TYPED_INGEST_ROUTE_BY_PATH,
  TYPED_INGEST_PATHS,
} from '../../src/modules/ingestion/route-table.js';
import { IngestSchema } from '../../src/modules/ingestion/types.js';
import { ROUTE_INGEST_PATHS } from '../../src/modules/projects/sdk-config/schema-v1.js';
import { SDK_EVENT_TYPES } from '../../src/modules/ingestion/pipeline/event-normalizer.js';

const INGESTION_ROUTE_PREFIX = '/api';

describe('distributed ingestion route contract', () => {
  it('exposes a backend POST route for every advertised SDK config route', () => {
    const backendPaths = new Set(TYPED_INGEST_PATHS.map((path) => `${INGESTION_ROUTE_PREFIX}${path}`));
    for (const [routeKey, advertisedPath] of Object.entries(ROUTE_INGEST_PATHS)) {
      expect(
        backendPaths.has(`${INGESTION_ROUTE_PREFIX}${advertisedPath}`),
        `ROUTE_INGEST_PATHS.${routeKey} = "${advertisedPath}" has no matching backend POST route`,
      ).toBe(true);
    }
  });

  it('gives every SDK event type exactly one dedicated typed route', () => {
    const typesWithRoute = TYPED_INGEST_ROUTES.map((route) => route.type).sort();
    const uniqueTypes = [...new Set(typesWithRoute)];

    // No duplicate route for any single event type.
    expect(typesWithRoute).toEqual(uniqueTypes);
    // Every canonical SDK event type is covered exactly once.
    expect(uniqueTypes).toEqual([...SDK_EVENT_TYPES].sort());
  });

  it('maps every typed route to a known SDK event type', () => {
    const known = new Set<string>(SDK_EVENT_TYPES);
    for (const route of TYPED_INGEST_ROUTES) {
      expect(
        known.has(route.type),
        `${route.path} maps to unknown SDK event type "${route.type}"`,
      ).toBe(true);
    }
  });

  it('routes the general /v1/events endpoint to the message family', () => {
    expect(TYPED_INGEST_ROUTE_BY_PATH.get('/v1/events')).toBe('message');
  });

  it('keeps the per-signal path -> event-type mapping stable', () => {
    expect(TYPED_INGEST_ROUTE_BY_PATH.get('/v1/errors')).toBe('error');
    expect(TYPED_INGEST_ROUTE_BY_PATH.get('/v1/requests')).toBe('request');
    expect(TYPED_INGEST_ROUTE_BY_PATH.get('/v1/traces')).toBe('trace');
    expect(TYPED_INGEST_ROUTE_BY_PATH.get('/v1/spans')).toBe('span');
    expect(TYPED_INGEST_ROUTE_BY_PATH.get('/v1/metrics')).toBe('metric');
    expect(TYPED_INGEST_ROUTE_BY_PATH.get('/v1/logs')).toBe('log');
    expect(TYPED_INGEST_ROUTE_BY_PATH.get('/v1/profiles')).toBe('profile');
    expect(TYPED_INGEST_ROUTE_BY_PATH.get('/v1/checkins')).toBe('cron_checkin');
    expect(TYPED_INGEST_ROUTE_BY_PATH.get('/v1/replays')).toBe('replay');
  });

  it('allows structured SDK stack frames on error ingestion payloads', () => {
    const body = IngestSchema.body as {
      properties: {
        events: {
          items: {
            properties: Record<string, unknown>;
          };
        };
      };
    };
    expect(body.properties.events.items.properties.stack).toMatchObject({
      type: 'array',
      items: {
        anyOf: expect.arrayContaining([
          { type: 'string' },
          { type: 'object' },
        ]),
      },
    });
  });
});
