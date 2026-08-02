import type { FastifySchema } from 'fastify';
import { type SdkEventType } from './pipeline/event-normalizer.js';
/** Canonical SDK event types (10 signals). */
export type EventType = SdkEventType;
/** SDK Request Event Payload */
export interface SDKRequestEvent {
    type: 'request';
    requestId: string;
    route?: string;
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
    statusCode: number;
    latency: number;
    timestamp: number;
    headers: Record<string, string>;
    query: Record<string, any>;
    bodySize: number;
    responseSize?: number;
    userId: string | null;
    traceId?: string;
    spanId?: string;
    metadata?: Record<string, any>;
}
/** SDK Error Event Payload */
export interface SDKErrorEvent {
    type: 'error';
    eventId?: string;
    requestId?: string;
    message: string;
    name?: string | Record<string, any>;
    stack?: unknown[];
    severity?: string;
    fingerprint?: string;
    traceId?: string;
    spanId?: string;
    sessionId?: string;
    statusCode?: number;
    statusText?: string;
    handled?: boolean;
    method?: string;
    route?: string;
    url?: string;
    timestamp: number;
    context?: Record<string, any>;
    metadata?: Record<string, any>;
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
    eventId?: string;
    metricName?: string;
    name?: string;
    metricType?: 'counter' | 'gauge' | 'histogram' | 'summary' | 'observable_counter' | 'observable_gauge' | 'up_down_counter';
    value?: number;
    unit?: string;
    metricUnit?: string;
    metricNamespace?: string;
    metricDescription?: string;
    count?: number;
    sum?: number;
    min?: number;
    max?: number;
    avg?: number;
    rate?: number;
    p50?: number;
    p75?: number;
    p90?: number;
    p95?: number;
    p99?: number;
    temporality?: 'delta' | 'cumulative' | 'unspecified';
    isMonotonic?: boolean;
    tags?: Record<string, string>;
    attributes?: Record<string, any>;
    metadata?: Record<string, any>;
    requestId?: string;
    sessionId?: string;
    tenantId?: string;
    traceId?: string;
    spanId?: string;
    timestamp: number;
}
export type SDKEvent = SDKRequestEvent | SDKErrorEvent | SDKLogEvent | SDKMetricEvent;
/** API Request Body */
export interface IngestRequest {
    apiKey?: string;
    events: SDKEvent[];
    metadata?: {
        environment: string;
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
    environment?: string;
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
    environment: string;
    requestId: string | null;
    message: string;
    errorType: string;
    fingerprint: string;
    stack: unknown;
    context: unknown;
    metadata: {
        environment: string;
    };
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
/** Internal Enriched Event (after API processing) */
export interface EnrichedEvent {
    id: string;
    type: EventType;
    projectId: string;
    orgId: string;
    environment: string;
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
    environment?: string;
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
export declare const ReplaySchema: FastifySchema;
export declare const ErrorListSchema: FastifySchema;
export declare const ErrorByIdSchema: FastifySchema;
//# sourceMappingURL=types.d.ts.map