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
import { type RollupShape, type WindowSize } from '../types.js';
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
/**
 * Reads distinct subject values per bucket, builds sketches (including the
 * project/environment sentinel rows so coarse reads stay consistent), and writes
 * them with a single `UPDATE … FROM (VALUES …)` per rollup table.
 *
 * Returns the number of rollup rows updated.
 */
export declare function applySketchPass(client: PoolClient, options: SketchPassOptions, params: SketchPassParams): Promise<number>;
//# sourceMappingURL=sketches.d.ts.map