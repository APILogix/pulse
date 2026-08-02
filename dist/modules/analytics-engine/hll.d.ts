/**
 * Dependency-free HyperLogLog for mergeable distinct counts.
 *
 * Why not a Postgres extension: the target Log DB cannot be assumed to have
 * `postgresql-hll`, and adding an extension requirement would block deployment
 * (docs/analytics/13-architecture-review.md W3). Sketches are produced and
 * merged exclusively by the analytics engine, so the format is private.
 *
 * Layout (BYTEA):
 *   byte 0      : format version (1)
 *   byte 1      : log2(registers)  — 14 → 16384 registers
 *   bytes 2..N  : one byte per register (max leading-zero run + 1)
 *
 * Size: 2 + 16384 bytes ≈ 16 KB per sketch; standard error ≈ 1.04/sqrt(m) ≈ 0.81 %.
 * Exact counts are stored alongside every sketch for the 1m tier, so live views
 * never depend on the estimate.
 */
export declare const HLL_VERSION = 1;
export declare const HLL_PRECISION = 14;
export declare const HLL_REGISTERS: number;
export declare function createSketch(): Uint8Array;
/**
 * 64-bit-ish hash built from two 32-bit FNV-1a passes with different offsets.
 * Adequate for cardinality estimation and avoids a crypto dependency in a hot
 * loop. Not used for anything security-sensitive.
 */
export declare function hashValue(value: string): {
    index: number;
    rank: number;
};
export declare function addToSketch(sketch: Uint8Array, value: string): Uint8Array;
export declare function sketchFromValues(values: Iterable<string>): Uint8Array;
export declare function isValidSketch(value: unknown): value is Uint8Array;
/**
 * Register-wise max. Commutative and associative, which is what makes rollup
 * compaction safe to re-run.
 */
export declare function mergeSketches(sketches: ReadonlyArray<Uint8Array | Buffer | null | undefined>): Uint8Array;
/** Cardinality estimate with small- and large-range correction. */
export declare function estimateCardinality(sketch: Uint8Array | Buffer | null | undefined): number;
/** Estimate the union cardinality of several sketches without materialising. */
export declare function estimateUnion(sketches: ReadonlyArray<Uint8Array | Buffer | null | undefined>): number;
/** Postgres BYTEA round-trip helpers. */
export declare function toBuffer(sketch: Uint8Array): Buffer;
export declare function fromBuffer(value: unknown): Uint8Array | null;
//# sourceMappingURL=hll.d.ts.map