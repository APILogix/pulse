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
export const HLL_VERSION = 1;
export const HLL_PRECISION = 14;
export const HLL_REGISTERS = 1 << HLL_PRECISION;
const HLL_HEADER_BYTES = 2;
/** Alpha correction constant for m = 16384. */
const ALPHA_M = 0.7213 / (1 + 1.079 / HLL_REGISTERS);
export function createSketch() {
    const buffer = new Uint8Array(HLL_HEADER_BYTES + HLL_REGISTERS);
    buffer[0] = HLL_VERSION;
    buffer[1] = HLL_PRECISION;
    return buffer;
}
/**
 * 64-bit-ish hash built from two 32-bit FNV-1a passes with different offsets.
 * Adequate for cardinality estimation and avoids a crypto dependency in a hot
 * loop. Not used for anything security-sensitive.
 */
export function hashValue(value) {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < value.length; i += 1) {
        const code = value.charCodeAt(i);
        h1 ^= code;
        h1 = Math.imul(h1, 0x01000193) >>> 0;
        h2 ^= code + i;
        h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
    }
    // Final avalanche so short keys spread across registers.
    h1 ^= h1 >>> 16;
    h1 = Math.imul(h1, 0x7feb352d) >>> 0;
    h1 ^= h1 >>> 15;
    h2 ^= h2 >>> 13;
    h2 = Math.imul(h2, 0xc2b2ae35) >>> 0;
    h2 ^= h2 >>> 16;
    const index = h1 >>> (32 - HLL_PRECISION);
    // Rank = position of the first set bit in the remaining hash bits, 1-based.
    let rank = 1;
    let bits = h2;
    while (rank <= 32 && (bits & 1) === 0) {
        rank += 1;
        bits >>>= 1;
    }
    return { index, rank: Math.min(rank, 255) };
}
export function addToSketch(sketch, value) {
    const { index, rank } = hashValue(value);
    const offset = HLL_HEADER_BYTES + index;
    if (rank > (sketch[offset] ?? 0))
        sketch[offset] = rank;
    return sketch;
}
export function sketchFromValues(values) {
    const sketch = createSketch();
    for (const value of values) {
        if (value === null || value === undefined || value === '')
            continue;
        addToSketch(sketch, value);
    }
    return sketch;
}
export function isValidSketch(value) {
    if (!(value instanceof Uint8Array) && !Buffer.isBuffer(value))
        return false;
    const bytes = value;
    return (bytes.length === HLL_HEADER_BYTES + HLL_REGISTERS &&
        bytes[0] === HLL_VERSION &&
        bytes[1] === HLL_PRECISION);
}
/**
 * Register-wise max. Commutative and associative, which is what makes rollup
 * compaction safe to re-run.
 */
export function mergeSketches(sketches) {
    const out = createSketch();
    for (const sketch of sketches) {
        if (!sketch || !isValidSketch(sketch))
            continue;
        for (let i = HLL_HEADER_BYTES; i < out.length; i += 1) {
            const candidate = sketch[i] ?? 0;
            if (candidate > (out[i] ?? 0))
                out[i] = candidate;
        }
    }
    return out;
}
/** Cardinality estimate with small- and large-range correction. */
export function estimateCardinality(sketch) {
    if (!sketch || !isValidSketch(sketch))
        return 0;
    let sum = 0;
    let zeroRegisters = 0;
    for (let i = HLL_HEADER_BYTES; i < sketch.length; i += 1) {
        const register = sketch[i] ?? 0;
        sum += 2 ** -register;
        if (register === 0)
            zeroRegisters += 1;
    }
    const raw = (ALPHA_M * HLL_REGISTERS * HLL_REGISTERS) / sum;
    // Linear counting is more accurate when many registers are still empty.
    if (raw <= 2.5 * HLL_REGISTERS && zeroRegisters > 0) {
        return Math.round(HLL_REGISTERS * Math.log(HLL_REGISTERS / zeroRegisters));
    }
    return Math.round(raw);
}
/** Estimate the union cardinality of several sketches without materialising. */
export function estimateUnion(sketches) {
    return estimateCardinality(mergeSketches(sketches));
}
/** Postgres BYTEA round-trip helpers. */
export function toBuffer(sketch) {
    // Copy rather than aliasing sketch.buffer: the underlying ArrayBufferLike may
    // be shared, and Buffer.from(ArrayBufferLike) is not type-safe under strict TS.
    return Buffer.from(sketch);
}
export function fromBuffer(value) {
    if (Buffer.isBuffer(value)) {
        return isValidSketch(value) ? new Uint8Array(value) : null;
    }
    if (value instanceof Uint8Array) {
        return isValidSketch(value) ? value : null;
    }
    return null;
}
//# sourceMappingURL=hll.js.map