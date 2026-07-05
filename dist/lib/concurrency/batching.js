import pMap from 'p-map';
/**
 * Splits an array into smaller chunks (batches) of a specified size.
 */
export function chunkArray(array, size) {
    if (!Number.isInteger(size) || size < 1) {
        throw new Error('Chunk size must be a positive integer');
    }
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}
/**
 * Processes items with bounded concurrency without serial chunk barriers.
 *
 * @param items The items to process
 * @param concurrency The maximum number of concurrent operations
 * @param processor The function to process each item
 */
export async function processInBatches(items, concurrency, processor, options = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
        throw new Error('Concurrency must be a positive integer');
    }
    let completed = 0;
    return pMap(items, async (item, index) => {
        const result = await processor(item, index);
        completed += 1;
        options.onProgress?.(completed, items.length);
        return result;
    }, {
        concurrency,
        signal: options.abortSignal,
    });
}
//# sourceMappingURL=batching.js.map