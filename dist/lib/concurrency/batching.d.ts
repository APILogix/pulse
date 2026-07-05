/**
 * Splits an array into smaller chunks (batches) of a specified size.
 */
export declare function chunkArray<T>(array: T[], size: number): T[][];
/**
 * Processes items with bounded concurrency without serial chunk barriers.
 *
 * @param items The items to process
 * @param concurrency The maximum number of concurrent operations
 * @param processor The function to process each item
 */
export declare function processInBatches<T, R>(items: T[], concurrency: number, processor: (item: T, index: number) => Promise<R>, options?: {
    abortSignal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
}): Promise<R[]>;
//# sourceMappingURL=batching.d.ts.map