/**
 * Flatten `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` output into one row per
 * captured statement.
 *
 * `scripts/explain-ingestion-writes.ts` captures a nested plan tree per writer
 * statement. A plan tree is the right artifact to keep, but it is the wrong
 * shape to report from: Requirement 8.3 wants the per-statement cost, and
 * Requirement 4.5 wants the index name **as it appears in the plan** rather than
 * as source reading infers it. This module turns the tree into a table.
 *
 * Two extraction details are load-bearing:
 *
 *   - WAL counters are summed across every plan node and stay `null` when no
 *     node reported one, so an absent counter stays distinguishable from a
 *     measured zero — the distinction Requirement 8.7's unmeasured path rests
 *     on. The summing matches `scripts/summarize-ingestion-explain.ts` so the
 *     two artifacts derived from the same capture cannot disagree.
 *   - `Conflict Arbiter Indexes` is read alongside `Index Name`. On the
 *     ingestion write path an `INSERT … ON CONFLICT DO NOTHING` names its
 *     idempotency index only as the arbiter, so reading `Index Name` alone would
 *     report zero index names for the statement whose index matters most.
 *
 * Every function here is pure, so the extraction is testable without a database
 * and without executing the capture script's `main()`.
 *
 * Design references: §1.1 (provenance envelope), §Component map (plan capture).
 */
import {
  recordMeasured,
  recordUnmeasured,
  type Measured,
  type Provenance,
} from './ingestion-evidence.js';
import { createHash } from 'crypto';

/** The per-statement cost the flattened table reports. */
export interface PlanCost {
  walRecords: number | null;
  walBytes: number | null;
  walFpi: number | null;
  planningMs: number | null;
  executionMs: number | null;
}

/** Everything one traversal of an EXPLAIN JSON entry yields. */
export interface PlanShape extends PlanCost {
  rootNodeType: string | null;
  /** Distinct `Node Type` values in depth-first order. */
  planNodeTypes: string[];
  /** Distinct index names as they appear in the plan, including ON CONFLICT arbiters. */
  indexNames: string[];
  rootActualRows: number | null;
}

/** Identity fields shared by measured and unmeasured statement rows. */
export interface StatementIdentity {
  /** Unique within a run: `<label>#<captureIndex>`. */
  statementKey: string;
  /** Stable grouping key for identical statement text across captures. */
  statementDigest: string;
  /** 1-based capture order across every explained statement in the run. */
  captureIndex: number;
  /** 1-based occurrence of this statement text within the run. */
  occurrence: number;
  label: string;
  statement: string;
  valueCount: number;
}

/**
 * One row per captured statement. The flat numeric fields carry the reportable
 * values; `evidence` carries the same values inside the provenance envelope so
 * the Requirement 17.4 gate validates every row uniformly, measured or not.
 */
export interface StatementEvidenceRow extends StatementIdentity, PlanCost {
  status: 'measured' | 'unmeasured';
  rootNodeType: string | null;
  planNodeTypes: string[];
  indexNames: string[];
  rootActualRows: number | null;
  evidence: Measured<PlanCost>;
}

/** Statements grouped by digest, for the Requirement 8.3 count and mean duration. */
export interface StatementTotalsRow {
  statementDigest: string;
  label: string;
  statement: string;
  captures: number;
  measuredCaptures: number;
  unmeasuredCaptures: number;
  walRecordsTotal: number | null;
  walBytesTotal: number | null;
  walFpiTotal: number | null;
  meanExecutionMs: number | null;
  maxExecutionMs: number | null;
  planNodeTypes: string[];
  indexNames: string[];
}

/* ------------------------------------------------------------------------- */
/* Statement identity                                                        */
/* ------------------------------------------------------------------------- */

/** Collapse whitespace so the same statement always digests identically. */
export function normalizeStatement(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

/** Stable grouping key for statements captured more than once in a run. */
export function statementDigest(statement: string): string {
  return createHash('sha256').update(normalizeStatement(statement)).digest('hex').slice(0, 12);
}

/**
 * The declared production-only pattern matching this statement, or `null`.
 *
 * Matched case-insensitively against the label and the statement text, so an
 * operator can name either `insert:events_errors` or a fragment of the SQL.
 * Requirement 8.6 needs the *declaration* to be recordable without a capture
 * attempt, because attempting the capture is what the requirement forbids.
 */
export function matchProductionOnly(
  patterns: readonly string[],
  label: string,
  statement: string,
): string | null {
  const haystack = `${label} ${statement}`.toLowerCase();
  return patterns.find((pattern) => haystack.includes(pattern.toLowerCase())) ?? null;
}

/* ------------------------------------------------------------------------- */
/* Plan traversal                                                            */
/* ------------------------------------------------------------------------- */

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `EXPLAIN (FORMAT JSON)` returns a single-element array; tolerate a bare object too. */
export function firstExplainEntry(raw: unknown): Record<string, unknown> | null {
  if (Array.isArray(raw)) return asObject(raw[0]);
  return asObject(raw);
}

function pushDistinct(target: string[], value: unknown): void {
  if (typeof value !== 'string' || value === '') return;
  if (!target.includes(value)) target.push(value);
}

interface TraversalAccumulator {
  walRecords: number | null;
  walBytes: number | null;
  walFpi: number | null;
  nodeTypes: string[];
  indexNames: string[];
}

const WAL_FIELDS = [
  ['WAL Records', 'walRecords'],
  ['WAL Bytes', 'walBytes'],
  ['WAL FPI', 'walFpi'],
] as const;

/** Depth-first traversal collecting WAL counters, node types and index names in one pass. */
function collectPlanNodes(node: Record<string, unknown> | null, acc: TraversalAccumulator): void {
  if (!node) return;

  pushDistinct(acc.nodeTypes, node['Node Type']);
  pushDistinct(acc.indexNames, node['Index Name']);
  const arbiters = node['Conflict Arbiter Indexes'];
  if (Array.isArray(arbiters)) {
    for (const arbiter of arbiters) pushDistinct(acc.indexNames, arbiter);
  }

  for (const [field, key] of WAL_FIELDS) {
    const value = asFiniteNumber(node[field]);
    if (value === null) continue;
    acc[key] = (acc[key] ?? 0) + value;
  }

  const children = Array.isArray(node.Plans) ? node.Plans : [];
  for (const child of children) collectPlanNodes(asObject(child), acc);
}

/** Flatten one captured `EXPLAIN (FORMAT JSON)` payload into a single row's fields. */
export function flattenPlan(plan: unknown): PlanShape {
  const entry = firstExplainEntry(plan);
  const rootPlan = asObject(entry?.Plan);
  const acc: TraversalAccumulator = {
    walRecords: null,
    walBytes: null,
    walFpi: null,
    nodeTypes: [],
    indexNames: [],
  };
  collectPlanNodes(rootPlan, acc);

  return {
    walRecords: acc.walRecords,
    walBytes: acc.walBytes,
    walFpi: acc.walFpi,
    planningMs: asFiniteNumber(entry?.['Planning Time']),
    executionMs: asFiniteNumber(entry?.['Execution Time']),
    rootNodeType: typeof rootPlan?.['Node Type'] === 'string' ? rootPlan['Node Type'] : null,
    planNodeTypes: acc.nodeTypes,
    indexNames: acc.indexNames,
    rootActualRows: asFiniteNumber(rootPlan?.['Actual Rows']),
  };
}

function planCostOf(shape: PlanCost): PlanCost {
  return {
    walRecords: shape.walRecords,
    walBytes: shape.walBytes,
    walFpi: shape.walFpi,
    planningMs: shape.planningMs,
    executionMs: shape.executionMs,
  };
}

/* ------------------------------------------------------------------------- */
/* Row constructors                                                          */
/* ------------------------------------------------------------------------- */

/** A statement whose plan was captured in an allowlisted measurement environment. */
export function measuredStatementRow(
  identity: StatementIdentity,
  plan: unknown,
  provenance: Provenance,
): StatementEvidenceRow {
  const shape = flattenPlan(plan);
  const cost = planCostOf(shape);
  return {
    ...identity,
    ...cost,
    status: 'measured',
    rootNodeType: shape.rootNodeType,
    planNodeTypes: shape.planNodeTypes,
    indexNames: shape.indexNames,
    rootActualRows: shape.rootActualRows,
    evidence: recordMeasured<PlanCost>({
      runs: [cost],
      median: cost,
      min: cost,
      max: cost,
      provenance: { ...provenance, repetitions: 1 },
    }),
  };
}

/**
 * A statement whose plan was omitted (Requirement 8.6).
 *
 * The declaration text comes from `recordUnmeasured()` so it cannot drift from
 * the byte-exact sentence, and `repetitions` is 0 because no capture summarizes
 * this row.
 */
export function unmeasuredStatementRow(
  identity: StatementIdentity,
  reason: string,
  provenance: Provenance,
): StatementEvidenceRow {
  return {
    ...identity,
    walRecords: null,
    walBytes: null,
    walFpi: null,
    planningMs: null,
    executionMs: null,
    status: 'unmeasured',
    rootNodeType: null,
    planNodeTypes: [],
    indexNames: [],
    rootActualRows: null,
    evidence: recordUnmeasured<PlanCost>(reason, { ...provenance, repetitions: 0 }),
  };
}

/* ------------------------------------------------------------------------- */
/* Aggregation                                                               */
/* ------------------------------------------------------------------------- */

function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  let total = 0;
  let seen = false;
  for (const value of values) {
    if (value === null) continue;
    total += value;
    seen = true;
  }
  return seen ? total : null;
}

/**
 * Group the flat rows by digest, so a statement captured more than once in a run
 * reports one execution count and one mean duration (Requirement 8.3).
 *
 * Only measured rows contribute to the sums and the mean; an omitted plan
 * contributes to `unmeasuredCaptures` alone, so an unmeasured capture can never
 * pull a reported average toward zero.
 */
export function statementTotals(
  rows: readonly StatementEvidenceRow[],
): StatementTotalsRow[] {
  const grouped = new Map<string, StatementEvidenceRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.statementDigest);
    if (bucket) bucket.push(row);
    else grouped.set(row.statementDigest, [row]);
  }

  const totals: StatementTotalsRow[] = [];
  for (const [digest, bucket] of grouped) {
    const first = bucket[0];
    if (first === undefined) continue;

    const measured = bucket.filter((row) => row.status === 'measured');
    const executionValues = measured
      .map((row) => row.executionMs)
      .filter((value): value is number => value !== null);
    const planNodeTypes: string[] = [];
    const indexNames: string[] = [];
    for (const row of bucket) {
      for (const nodeType of row.planNodeTypes) pushDistinct(planNodeTypes, nodeType);
      for (const indexName of row.indexNames) pushDistinct(indexNames, indexName);
    }

    totals.push({
      statementDigest: digest,
      label: first.label,
      statement: first.statement,
      captures: bucket.length,
      measuredCaptures: measured.length,
      unmeasuredCaptures: bucket.length - measured.length,
      walRecordsTotal: sumOrNull(measured.map((row) => row.walRecords)),
      walBytesTotal: sumOrNull(measured.map((row) => row.walBytes)),
      walFpiTotal: sumOrNull(measured.map((row) => row.walFpi)),
      meanExecutionMs: executionValues.length > 0
        ? executionValues.reduce((sum, value) => sum + value, 0) / executionValues.length
        : null,
      maxExecutionMs: executionValues.length > 0 ? Math.max(...executionValues) : null,
      planNodeTypes,
      indexNames,
    });
  }

  return totals;
}
