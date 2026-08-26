/**
 * HyperLogLog sketch pass.
 *
 * Postgres cannot build the sketches for us without an extension
 * (docs/analytics/13-architecture-review.md W3), so the engine builds them in
 * Node from a *distinct-value* query — which is bounded by cardinality, not by
 * row count, and therefore far cheaper than scanning raw rows again.
 *
 * The pass runs immediately after the main rollup statement inside the same
 * transaction, so the target rows are guaranteed to exist and the sketch is
 * committed atomically with the counters it belongs to.
 *
 * When the distinct-value set exceeds the configured cap the sketch is left
 * NULL. Readers then fall back to `MAX(unique_*_exact)` across buckets and mark
 * the value approximate — an honest lower bound instead of a wrong number.
 */

import type { PoolClient } from 'pg';
import { sketchFromValues, toBuffer } from '../hll.js';
import { bucketExpression } from '../windows.js';
import {
  ALL_ENVIRONMENTS_SENTINEL,
  ALL_PROJECTS_SENTINEL,
  type RollupShape,
  type WindowSize,
} from '../types.js';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertIdentifier(value: string, kind: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`Analytics sketch ${kind} is not a safe identifier: ${value}`);
  }
}

export interface SketchPassOptions {
  /** Canonical source table. */
  source: string;
  /** Column holding the identity being counted (user_id, session_id, …). */
  subjectColumn: string;
  /** Rollup table receiving the sketch. */
  targetTable: string;
  /** Sketch column, e.g. `unique_users_hll`. */
  targetColumn: string;
  window: WindowSize;
  shape: RollupShape;
  timeColumn?: string;
  ingestColumn?: string;
  where?: string;
  /** Entity expression for Shape B targets. */
  entityKeyExpr?: string;
  /** Maximum distinct (bucket, subject) pairs to pull. */
  maxRows: number;
}

export interface SketchPassParams {
  orgId: string;
  ingestStart: Date;
  ingestEnd: Date;
  recomputeFrom: Date;
}

interface SketchGroupKey {
  projectId: string;
  environment: string;
  bucket: string;
  entityKey: string | null;
}

function groupId(key: SketchGroupKey): string {
  return `${key.projectId}\u0000${key.environment}\u0000${key.bucket}\u0000${key.entityKey ?? ''}`;
}

/**
 * Reads distinct subject values per bucket, builds sketches (including the
 * project/environment sentinel rows so coarse reads stay consistent), and writes
 * them with a single `UPDATE … FROM (VALUES …)` per rollup table.
 *
 * Returns the number of rollup rows updated.
 */
export async function applySketchPass(
  client: PoolClient,
  options: SketchPassOptions,
  params: SketchPassParams,
): Promise<number> {
  assertIdentifier(options.source, 'source');
  assertIdentifier(options.targetTable, 'target table');
  assertIdentifier(options.targetColumn, 'target column');
  assertIdentifier(options.subjectColumn, 'subject column');

  const timeColumn = options.timeColumn ?? 'occurred_at';
  const ingestColumn = options.ingestColumn ?? 'ingested_at';
  const bucket = bucketExpression(`e.${timeColumn}`, options.window);
  const entityExpr = options.shape === 'B' ? (options.entityKeyExpr ?? null) : null;

  if (options.shape === 'B' && !entityExpr) {
    throw new Error('Analytics sketch pass on a Shape B table requires entityKeyExpr');
  }

  const where = [
    'e.organization_id = $1',
    'e.project_id IS NOT NULL',
    `e.${options.subjectColumn} IS NOT NULL`,
    `e.${ingestColumn} >= $2`,
    `e.${ingestColumn} <  $3`,
    `e.${timeColumn}   >= $4`,
    ...(options.where ? [options.where] : []),
  ].join(' AND ');

  const selected = await client.query<{
    project_id: string;
    environment: string;
    bucket: Date;
    entity_key: string | null;
    subject: string;
  }>(
    `SELECT DISTINCT
            e.project_id                        AS project_id,
            e.environment                       AS environment,
            ${bucket}                           AS bucket,
            ${entityExpr ? `${entityExpr}` : 'NULL::text'} AS entity_key,
            e.${options.subjectColumn}::text    AS subject
       FROM ${options.source} e
      WHERE ${where}
      LIMIT $5`,
    [params.orgId, params.ingestStart, params.ingestEnd, params.recomputeFrom, options.maxRows + 1],
  );

  // Cap exceeded: leave sketches NULL rather than persisting a partial sketch.
  if (selected.rowCount !== null && selected.rowCount > options.maxRows) {
    return 0;
  }
  if (selected.rows.length === 0) return 0;

  // Fan every observation into its own group plus the sentinel roll-up groups.
  const groups = new Map<string, { key: SketchGroupKey; values: Set<string> }>();
  const push = (key: SketchGroupKey, value: string): void => {
    const id = groupId(key);
    let entry = groups.get(id);
    if (!entry) {
      entry = { key, values: new Set<string>() };
      groups.set(id, entry);
    }
    entry.values.add(value);
  };

  for (const row of selected.rows) {
    const bucketIso = new Date(row.bucket).toISOString();
    const entityKey = row.entity_key;
    push({ projectId: row.project_id, environment: row.environment, bucket: bucketIso, entityKey }, row.subject);
    push({ projectId: row.project_id, environment: ALL_ENVIRONMENTS_SENTINEL, bucket: bucketIso, entityKey }, row.subject);
    push({ projectId: ALL_PROJECTS_SENTINEL, environment: ALL_ENVIRONMENTS_SENTINEL, bucket: bucketIso, entityKey }, row.subject);
  }

  const values: unknown[] = [params.orgId];
  const tuples: string[] = [];
  for (const { key, values: subjects } of groups.values()) {
    const sketch = toBuffer(sketchFromValues(subjects));
    const placeholders: string[] = [];
    for (const value of [key.projectId, key.environment, key.bucket, key.entityKey, sketch]) {
      values.push(value);
      placeholders.push(`$${values.length}`);
    }
    tuples.push(`(${placeholders[0]}::uuid, ${placeholders[1]}::text, ${placeholders[2]}::timestamptz, ${placeholders[3]}::text, ${placeholders[4]}::bytea)`);
  }

  const entityPredicate = options.shape === 'B' ? 'AND t.entity_key = v.entity_key' : '';

  const result = await client.query(
    `UPDATE ${options.targetTable} t
        SET ${options.targetColumn} = v.sketch,
            updated_at = NOW()
       FROM (VALUES ${tuples.join(',')}) AS v(project_id, environment, bucket, entity_key, sketch)
      WHERE t.organization_id = $1
        AND t.project_id  = v.project_id
        AND t.environment = v.environment
        AND t.bucket      = v.bucket
        ${entityPredicate}`,
    values,
  );

  return result.rowCount ?? 0;
}
