import { describe, expect, it, vi } from 'vitest';
import { ErrorRepository } from './error.repository.js';
function record(overrides = {}) {
    return {
        id: 'event-row-1',
        organization_id: '11111111-1111-4111-8111-111111111111',
        project_id: '22222222-2222-4222-8222-222222222222',
        api_key_name: 'pk_live_test',
        environment: 'production',
        event_id: 'evt-1',
        request_id: null,
        trace_id: null,
        span_id: null,
        parent_span_id: null,
        session_id: null,
        user_id: null,
        fingerprint: 'fingerprint-1',
        fingerprint_version: 2,
        error_name: 'Error',
        message: 'boom',
        severity: 'error',
        mechanism: null,
        handled: null,
        method: null,
        route: null,
        url: null,
        status_code: null,
        status_text: null,
        stack_frames: [],
        breadcrumbs: [],
        context: {},
        service: null,
        server_name: null,
        release: null,
        sdk_name: null,
        sdk_version: null,
        application_name: null,
        application_version: null,
        tags: {},
        extra: {},
        metadata: {},
        ai_response: null,
        occurred_at: new Date('2026-08-24T00:00:00.000Z'),
        payload: { type: 'error', message: 'boom' },
        error_group_id: null,
        ...overrides,
    };
}
describe('ErrorRepository', () => {
    it('bulk inserts error events in one statement and preserves input order for returned rows', async () => {
        const first = record();
        const second = record({
            id: 'event-row-2',
            event_id: 'evt-2',
            occurred_at: new Date('2026-08-24T00:00:01.000Z'),
            fingerprint: 'fingerprint-2',
        });
        const queries = [];
        const client = {
            query: vi.fn(async (sql, values) => {
                queries.push({ sql, values: values ?? [] });
                return {
                    rowCount: 2,
                    rows: [
                        {
                            id: 'event-row-2',
                            organization_id: second.organization_id,
                            event_id: second.event_id,
                            occurred_at: second.occurred_at,
                        },
                        {
                            id: 'event-row-1',
                            organization_id: first.organization_id,
                            event_id: first.event_id,
                            occurred_at: first.occurred_at,
                        },
                    ],
                };
            }),
        };
        const repository = new ErrorRepository({});
        const inserted = await repository.insertManyIfNew(client, [first, second]);
        expect(client.query).toHaveBeenCalledTimes(1);
        expect(queries[0]?.sql).toContain('INSERT INTO events_errors');
        expect(queries[0]?.sql).toContain('ON CONFLICT (organization_id, event_id, occurred_at) DO NOTHING');
        expect(queries[0]?.sql).toContain('RETURNING id, organization_id, event_id, occurred_at');
        expect(queries[0]?.sql).toContain('$24::jsonb');
        expect(queries[0]?.sql).toContain('$65::jsonb');
        expect(queries[0]?.values).toHaveLength(82);
        expect(inserted.map((row) => row.eventId)).toEqual(['evt-1', 'evt-2']);
    });
    it('attaches error groups in one update statement', async () => {
        const queries = [];
        const client = {
            query: vi.fn(async (sql, values) => {
                queries.push({ sql, values: values ?? [] });
                return { rowCount: 2, rows: [] };
            }),
        };
        const repository = new ErrorRepository({});
        await repository.attachGroups(client, [
            {
                organizationId: '11111111-1111-4111-8111-111111111111',
                eventId: 'evt-1',
                occurredAt: new Date('2026-08-24T00:00:00.000Z'),
                groupId: '33333333-3333-4333-8333-333333333333',
            },
            {
                organizationId: '11111111-1111-4111-8111-111111111111',
                eventId: 'evt-2',
                occurredAt: new Date('2026-08-24T00:00:01.000Z'),
                groupId: '44444444-4444-4444-8444-444444444444',
            },
        ]);
        expect(client.query).toHaveBeenCalledTimes(1);
        expect(queries[0]?.sql).toContain('UPDATE events_errors AS e');
        expect(queries[0]?.sql).toContain('FROM (VALUES ($1::uuid, $2, $3::timestamptz, $4::uuid), ($5::uuid, $6, $7::timestamptz, $8::uuid))');
        expect(queries[0]?.sql).toContain('SET error_group_id = v.group_id::uuid');
        expect(queries[0]?.values).toHaveLength(8);
    });
    it('findByGroup resolves both direct events and merged groups via subquery', async () => {
        const queries = [];
        const pool = {
            query: vi.fn(async (sql, values) => {
                queries.push({ sql, values: values ?? [] });
                return { rows: [{ id: 'evt-1' }] };
            }),
        };
        const repository = new ErrorRepository(pool);
        const results = await repository.findByGroup('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 50);
        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(queries[0]?.sql).toContain('error_group_id = $2');
        expect(queries[0]?.sql).toContain('SELECT id FROM error_groups WHERE project_id = $1 AND merged_into = $2');
        expect(queries[0]?.values).toEqual(['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 50]);
        expect(results).toHaveLength(1);
    });
});
//# sourceMappingURL=error.repository.test.js.map