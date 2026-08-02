/**
 * analytics.ai - AI runtime cost, failures and latency by model.
 *
 * Reads  : ai_requests
 * Writes : ai_metrics_1m
 */
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
export declare function createAiWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=ai.worker.d.ts.map