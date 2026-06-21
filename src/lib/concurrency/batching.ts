import { createLimiter } from './limiters.js';

/**
 * Splits an array into smaller chunks (batches) of a specified size.
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Processes an array of items in batches, with a concurrency limit on how many
 * items are processed concurrently within each batch.
 * 
 * @param items The items to process
 * @param batchSize The size of each chunk
 * @param concurrency The maximum number of concurrent operations
 * @param processor The function to process each item
 */
export async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  concurrency: number,
  processor: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const chunks = chunkArray(items, batchSize);
  const limit = createLimiter(concurrency);
  const results: R[] = [];

  let globalIndex = 0;
  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
      chunk.map((item) => limit(() => processor(item, globalIndex++)))
    );
    results.push(...chunkResults);
  }

  return results;
}
