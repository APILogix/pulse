import { describe, expect, it } from 'vitest';

import { UNMEASURED, type Provenance } from './ingestion-evidence.js';
import {
  flattenPlan,
  matchProductionOnly,
  measuredStatementRow,
  statementDigest,
  statementTotals,
  unmeasuredStatementRow,
  type StatementIdentity,
} from './explain-plan-flatten.js';

const provenance: Provenance = {
  command: 'npm run explain:ingestion -- --type mixed',
  environment: 'benchmark',
  timestampUtc: '2024-05-01T12:00:00.000Z',
  gitCommit: 'abc1234',
  repetitions: 1,
};

function identity(overrides: Partial<StatementIdentity> = {}): StatementIdentity {
  const statement = overrides.statement ?? 'INSERT INTO events_errors (id) VALUES ($1)';
  return {
    statementKey: 'insert:events_errors#1',
    statementDigest: statementDigest(statement),
    captureIndex: 1,
    occurrence: 1,
    label: 'insert:events_errors',
    statement,
    valueCount: 1,
    ...overrides,
  };
}

/**
 * Shaped after real `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` output for the
 * TelemetryWriter's multi-row `INSERT … ON CONFLICT DO NOTHING`, including the
 * arbiter index, which is the only place the idempotency index appears.
 */
const insertPlan = [
  {
    Plan: {
      'Node Type': 'ModifyTable',
      Operation: 'Insert',
      'Relation Name': 'events_errors',
      'Conflict Resolution': 'NOTHING',
      'Conflict Arbiter Indexes': ['idx_events_errors_event_unique'],
      'Actual Rows': 200,
      'WAL Records': 812,
      'WAL FPI': 3,
      'WAL Bytes': 245_760,
      Plans: [
        {
          'Node Type': 'Values Scan',
          'Parent Relationship': 'Outer',
          'Actual Rows': 200,
          'WAL Records': 4,
          'WAL Bytes': 240,
        },
      ],
    },
    'Planning Time': 1.234,
    Triggers: [
      {
        'Trigger Name': 'trg_sync_typed_event_contract',
        Relation: 'events_errors',
        Time: 4.5,
        Calls: 200,
      },
    ],
    'Execution Time': 42.5,
  },
];

const outboxPlan = [
  {
    Plan: {
      'Node Type': 'Insert',
      'Relation Name': 'telemetry_outbox',
      'Actual Rows': 12,
      'WAL Records': 24,
      'WAL Bytes': 3_200,
      Plans: [
        {
          'Node Type': 'Nested Loop',
          Plans: [
            {
              'Node Type': 'Index Only Scan',
              'Index Name': 'alert_runtime_idempotency_keys_pkey',
              'Actual Rows': 12,
            },
            {
              'Node Type': 'Index Scan',
              'Index Name': 'idx_telemetry_outbox_pending',
              'Actual Rows': 0,
            },
          ],
        },
      ],
    },
    'Planning Time': 0.5,
    'Execution Time': 6.25,
  },
];

describe('flattenPlan', () => {
  it('sums WAL counters across every plan node', () => {
    const shape = flattenPlan(insertPlan);
    expect(shape.walRecords).toBe(816); // 812 on ModifyTable + 4 on Values Scan
    expect(shape.walBytes).toBe(246_000); // 245_760 + 240
    expect(shape.walFpi).toBe(3); // only ModifyTable reported FPI
  });

  it('records an absent WAL counter as null rather than zero', () => {
    const shape = flattenPlan([{ Plan: { 'Node Type': 'ModifyTable' } }]);
    expect(shape.walRecords).toBeNull();
    expect(shape.walBytes).toBeNull();
    expect(shape.walFpi).toBeNull();
  });

  it('distinguishes a measured zero from an absent counter', () => {
    const shape = flattenPlan([{ Plan: { 'Node Type': 'ModifyTable', 'WAL Records': 0 } }]);
    expect(shape.walRecords).toBe(0);
    expect(shape.walBytes).toBeNull();
  });

  it('collects plan node types depth-first without duplicates', () => {
    expect(flattenPlan(outboxPlan).planNodeTypes).toEqual([
      'Insert',
      'Nested Loop',
      'Index Only Scan',
      'Index Scan',
    ]);
  });

  it('extracts the ON CONFLICT arbiter index name from the plan', () => {
    expect(flattenPlan(insertPlan).indexNames).toEqual(['idx_events_errors_event_unique']);
  });

  it('extracts index names from scan nodes at any depth', () => {
    expect(flattenPlan(outboxPlan).indexNames).toEqual([
      'alert_runtime_idempotency_keys_pkey',
      'idx_telemetry_outbox_pending',
    ]);
  });

  it('reports planning time, execution time, root node type and root actual rows', () => {
    const shape = flattenPlan(insertPlan);
    expect(shape.planningMs).toBe(1.234);
    expect(shape.executionMs).toBe(42.5);
    expect(shape.rootNodeType).toBe('ModifyTable');
    expect(shape.rootActualRows).toBe(200);
  });

  it('tolerates a bare entry object instead of the single-element array', () => {
    const [entry] = insertPlan;
    expect(flattenPlan(entry).rootNodeType).toBe('ModifyTable');
  });

  it('returns an empty shape for a missing plan', () => {
    const shape = flattenPlan(null);
    expect(shape.rootNodeType).toBeNull();
    expect(shape.planNodeTypes).toEqual([]);
    expect(shape.indexNames).toEqual([]);
    expect(shape.executionMs).toBeNull();
  });
});

describe('statementDigest', () => {
  it('is insensitive to whitespace so a reformatted statement groups identically', () => {
    expect(statementDigest('INSERT  INTO\n  events_errors')).toBe(
      statementDigest('INSERT INTO events_errors'),
    );
  });

  it('differs for different statements', () => {
    expect(statementDigest('INSERT INTO events_errors')).not.toBe(
      statementDigest('INSERT INTO events_spans'),
    );
  });
});

describe('matchProductionOnly', () => {
  it('matches a label pattern case-insensitively', () => {
    expect(matchProductionOnly(['INSERT:EVENTS_ERRORS'], 'insert:events_errors', 'INSERT INTO x'))
      .toBe('INSERT:EVENTS_ERRORS');
  });

  it('matches a statement fragment', () => {
    expect(matchProductionOnly(['on conflict'], 'insert:events_errors', 'INSERT INTO x ON CONFLICT DO NOTHING'))
      .toBe('on conflict');
  });

  it('returns null when nothing matches and when no pattern is declared', () => {
    expect(matchProductionOnly(['events_spans'], 'insert:events_errors', 'INSERT INTO x')).toBeNull();
    expect(matchProductionOnly([], 'insert:events_errors', 'INSERT INTO x')).toBeNull();
  });
});

describe('statement rows', () => {
  it('builds a measured row whose envelope summarizes exactly one capture', () => {
    const row = measuredStatementRow(identity(), insertPlan, provenance);
    expect(row.status).toBe('measured');
    expect(row.walRecords).toBe(816);
    expect(row.indexNames).toEqual(['idx_events_errors_event_unique']);
    expect(row.evidence.status).toBe('measured');
    if (row.evidence.status !== 'measured') throw new Error('expected a measured envelope');
    expect(row.evidence.provenance.repetitions).toBe(1);
    expect(row.evidence.runs).toHaveLength(1);
    expect(row.evidence.value.walRecords).toBe(816);
  });

  it('builds an unmeasured row carrying the byte-exact declaration and no plan values', () => {
    const row = unmeasuredStatementRow(identity(), 'plan obtainable only from production', provenance);
    expect(row.status).toBe('unmeasured');
    expect(row.walRecords).toBeNull();
    expect(row.planNodeTypes).toEqual([]);
    expect(row.indexNames).toEqual([]);
    expect(row.evidence.status).toBe('unmeasured');
    if (row.evidence.status !== 'unmeasured') throw new Error('expected an unmeasured envelope');
    expect(row.evidence.declaration).toBe(UNMEASURED);
    expect(row.evidence.reason).toBe('plan obtainable only from production');
    expect(row.evidence.provenance.repetitions).toBe(0);
  });
});

describe('statementTotals', () => {
  it('groups repeated captures of the same statement into one row', () => {
    const rows = [
      measuredStatementRow(identity({ captureIndex: 1, occurrence: 1 }), insertPlan, provenance),
      measuredStatementRow(identity({ captureIndex: 2, occurrence: 2 }), insertPlan, provenance),
    ];
    const totals = statementTotals(rows);
    expect(totals).toHaveLength(1);
    expect(totals[0]?.captures).toBe(2);
    expect(totals[0]?.measuredCaptures).toBe(2);
    expect(totals[0]?.walRecordsTotal).toBe(1_632);
    expect(totals[0]?.meanExecutionMs).toBe(42.5);
    expect(totals[0]?.maxExecutionMs).toBe(42.5);
  });

  it('keeps distinct statements in distinct rows and unions their plan facts', () => {
    const outboxStatement = 'WITH ins AS (INSERT INTO telemetry_outbox ...) SELECT 1';
    const rows = [
      measuredStatementRow(identity(), insertPlan, provenance),
      measuredStatementRow(
        identity({
          statement: outboxStatement,
          statementDigest: statementDigest(outboxStatement),
          label: 'cte:telemetry_outbox',
          captureIndex: 2,
        }),
        outboxPlan,
        provenance,
      ),
    ];
    const totals = statementTotals(rows);
    expect(totals).toHaveLength(2);
    expect(totals.map((total) => total.label)).toEqual(['insert:events_errors', 'cte:telemetry_outbox']);
    expect(totals[1]?.indexNames).toEqual([
      'alert_runtime_idempotency_keys_pkey',
      'idx_telemetry_outbox_pending',
    ]);
  });

  it('excludes an unmeasured capture from the sums and the mean', () => {
    const rows = [
      measuredStatementRow(identity(), insertPlan, provenance),
      unmeasuredStatementRow(identity({ captureIndex: 2, occurrence: 2 }), 'EXPLAIN failed', provenance),
    ];
    const totals = statementTotals(rows);
    expect(totals).toHaveLength(1);
    expect(totals[0]?.captures).toBe(2);
    expect(totals[0]?.measuredCaptures).toBe(1);
    expect(totals[0]?.unmeasuredCaptures).toBe(1);
    expect(totals[0]?.walRecordsTotal).toBe(816);
    expect(totals[0]?.meanExecutionMs).toBe(42.5);
  });

  it('reports null aggregates when every capture of a statement is unmeasured', () => {
    const totals = statementTotals([
      unmeasuredStatementRow(identity(), 'EXPLAIN failed', provenance),
    ]);
    expect(totals[0]?.walRecordsTotal).toBeNull();
    expect(totals[0]?.meanExecutionMs).toBeNull();
    expect(totals[0]?.maxExecutionMs).toBeNull();
  });

  it('returns no rows for no captures', () => {
    expect(statementTotals([])).toEqual([]);
  });
});
