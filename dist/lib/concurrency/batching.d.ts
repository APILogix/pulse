/**
 * Splits an array into smaller chunks (batches) of a specified size.
 */
export declare function chunkArray<T>(array: T[], size: number): T[][];
/**
 * Processes an array of items in batches, with a concurrency limit on how many
 * items are processed concurrently within each batch.
 *
 * @param items The items to process
 * @param batchSize The size of each chunk
 * @param concurrency The maximum number of concurrent operations
 * @param processor The function to process each item
 */
export declare function processInBatches<T, R>(items: T[], batchSize: number, concurrency: number, processor: (item: T, index: number) => Promise<R>): Promise<R[]>;
//# sourceMappingURL=batching.d.ts.map