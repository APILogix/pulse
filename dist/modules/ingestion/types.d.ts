import type { FastifySchema } from 'fastify';
import { type SdkEventType } from './pipeline/event-normalizer.js';
/** Canonical SDK event types (10 signals). */
export type EventType = SdkEventType;
/** SDK Request Event Payload */
export interface SDKRequestEvent {
    type: 'request';
    requestId: string;
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
    statusCode: number;
    latency: number;
    timestamp: number;
    headers: Record<string, string>;
    query: Record<string, any>;
    bodySize: number;
    userId: string | null;
}
/** SDK Error Event Payload */
export interface SDKErrorEvent {
    type: 'error';
    requestId: string;
    message: string;
    name: string | Record<string, any>;
    stack: string[];
    fingerprint: string;
    timestamp: number;
    context: Record<string, any>;
}
/** SDK Log Event Payload */
export interface SDKLogEvent {
    type: 'log';
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    timestamp: number;
    requestId?: string;
    metadata?: Record<string, any>;
}
/** SDK Metric Event Payload */
export interface SDKMetricEvent {
    type: 'metric';
    name: string;
    value: number;
    unit?: string;
    tags?: Record<string, string>;
    metadata?: Record<string, any>;
    requestId?: string;
    timestamp: number;
}
export type SDKEvent = SDKRequestEvent | SDKErrorEvent | SDKLogEvent | SDKMetricEvent;
/** API Request Body */
export interface IngestRequest {
    apiKey: string;
    events: SDKEvent[];
    metadata?: {
        sdkVersion?: string;
        compression?: 'gzip' | 'none';
        batchId?: string;
    };
}
/** API Response */
export interface IngestResponse {
    success: boolean;
    accepted: number;
    rejected: number;
    batchId: string;
    limits?: {
        remaining: number;
        resetAt: number;
    };
    errors?: Array<{
        eventId: string;
        reason: string;
    }>;
}
export interface ErrorEventListQuery {
    projectId: string;
    limit?: number;
    offset?: number;
    from?: string;
    to?: string;
    fingerprint?: string;
    errorType?: string;
    resolved?: boolean;
}
export interface NormalizedErrorEventListQuery extends ErrorEventListQuery {
    limit: number;
    offset: number;
}
export interface ErrorEventRecord {
    id: string;
    eventId: string;
    projectId: string;
    requestId: string | null;
    message: string;
    errorType: string;
    fingerprint: string;
    stack: unknown;
    context: unknown;
    metadata: unknown;
    timestamp: string;
    createdAt: string;
    resolvedAt: string | null;
    resolvedBy: string | null;
    ingestedAt: string | null;
    payload: SDKErrorEvent;
}
export interface ErrorEventListResult {
    data: ErrorEventRecord[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
}
/** SDK Init Response — Matches your SDK expectation exactly */
export interface SDKInitResponse {
    success: boolean;
    projectId: string;
    config: {
        samplingRate: number;
        enableErrors: boolean;
        enablePerformance: boolean;
    };
    ingestion: {
        endpoint: string;
        batchSize: number;
        flushInterval: number;
        maxQueueSize: number;
    };
}
/** Internal Enriched Event (after API processing) */
export interface EnrichedEvent {
    id: string;
    type: EventType;
    projectId: string;
    orgId: string;
    requestId?: string;
    receivedAt: number;
    ingestedAt?: string;
    batchId: string;
    payload: SDKEvent;
}
/** Replay Request */
export interface ReplayRequest {
    projectId: string;
    startTime: string;
    endTime: string;
    eventTypes?: EventType[];
    targetQueue?: string;
}
/** Health Status */
export interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    services: {
        redis: boolean;
        database: boolean;
        queue: boolean;
    };
    queueMetrics?: {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
    };
    timestamp: string;
}
export declare const IngestSchema: FastifySchema;
export declare const InitSchema: FastifySchema;
export declare const ReplaySchema: FastifySchema;
export declare const ErrorListSchema: FastifySchema;
export declare const ErrorByIdSchema: FastifySchema;
//# sourceMappingURL=types.d.ts.map