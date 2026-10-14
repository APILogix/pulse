import type { FastifySchema } from 'fastify';
import { SDK_EVENT_TYPES, type SdkEventType } from './pipeline/event-normalizer.js';

/** Canonical SDK event types (10 signals). */
export type EventType = SdkEventType;
export type SDKTimestamp = number | string;

/** SDK Request Event Payload */
export interface SDKRequestEvent {
  type: 'request';
  requestId: string;
  route?: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
  statusCode: number;
  latency: number;
  timestamp: SDKTimestamp;
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
  timestamp: SDKTimestamp;
  context?: Record<string, any>;
  metadata?: Record<string, any>;
}

/** SDK Log Event Payload */
export interface SDKLogEvent {
  type: 'log';
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: SDKTimestamp;
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
  timestamp: SDKTimestamp;
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
  config_u?: boolean;
  change?: boolean;
  limits?: {
    remaining: number;
    resetAt: number;
  };
  errors?: Array<{ eventId: string; reason: string }>;
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
  metadata: { environment: string };
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

/** Fastify Validation Schemas */
const sdkTypeEnum = [...SDK_EVENT_TYPES];

export const IngestSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['events'],
    properties: {
      apiKey: { type: 'string', minLength: 32, maxLength: 128 },
      events: {
        type: 'array',
        minItems: 1,
        maxItems: 1000,
        items: {
          type: 'object',
          required: ['type'],
          properties: {
            type: {
              type: 'string',
              enum: sdkTypeEnum,
            },
            timestamp: {
              anyOf: [
                { type: 'number' },
                { type: 'string', minLength: 1, maxLength: 64 },
              ],
            },
            eventId: { type: 'string', maxLength: 128 },
            requestId: { type: 'string', maxLength: 128 },
            metricName: { type: 'string' },
            name: { type: 'string' },
            metricType: { type: 'string', enum: ['counter', 'gauge', 'histogram'] },
            url: { type: 'string' },
            route: { type: 'string', maxLength: 2048 },
            method: { 
              type: 'string', 
              enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'] 
            },
            statusCode: { type: 'integer' },
            statusText: { type: 'string', maxLength: 128 },
            handled: { type: 'boolean' },
            latency: { type: 'integer', minimum: 0 },
            bodySize: { type: 'integer', minimum: 0 },
            responseSize: { type: 'integer', minimum: 0 },
            traceId: { type: 'string', maxLength: 128 },
            spanId: { type: 'string', maxLength: 128 },
            rootSpan: { type: 'object' },
            spanCount: { type: 'integer', minimum: 0 },
            totalDuration: { type: 'number', minimum: 0 },
            isPartial: { type: 'boolean' },
            userId: { type: ['string', 'null'] },
            message: { type: 'string' },
            fingerprint: { type: 'string' },
            stack: {
              type: 'array',
              maxItems: 200,
              items: {
                anyOf: [
                  { type: 'string' },
                  { type: 'object' },
                  { type: 'array' },
                  { type: 'number' },
                  { type: 'boolean' },
                  { type: 'null' },
                ],
              },
            },
            context: { type: 'object' },
            level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
            headers: { type: 'object' },
            query: { type: 'object' },
            attributes: { type: 'object' },
            metadata: { type: 'object' },
          }
        }
      },
      metadata: {
        type: 'object',
        required: [],
        properties: {
          environment: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            pattern: '^\\s*[A-Za-z0-9][A-Za-z0-9._-]*\\s*$',
          },
          sdkVersion: { type: 'string', maxLength: 64 },
          sdkName: { type: 'string', maxLength: 64 },
          applicationName: { type: 'string', maxLength: 128 },
          applicationVersion: { type: 'string', maxLength: 64 },
          release: { type: 'string', maxLength: 128 },
          compression: { type: 'string', enum: ['gzip', 'none'] },
          batchId: { type: 'string', maxLength: 128 },
        },
        additionalProperties: false,
      }
    }
  }
};

export const ReplaySchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['projectId', 'startTime', 'endTime'],
    properties: {
      projectId: { type: 'string', format: 'uuid' },
      startTime: { type: 'string', format: 'date-time' },
      endTime: { type: 'string', format: 'date-time' },
      environment: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        pattern: '^\\s*[A-Za-z0-9][A-Za-z0-9._-]*\\s*$',
      },
      eventTypes: {
        type: 'array',
        items: { type: 'string', enum: sdkTypeEnum },
      },
      targetQueue: { type: 'string', default: 'ingestion' }
    }
  }
};

export const ErrorListSchema: FastifySchema = {
  querystring: {
    type: 'object',
    required: ['projectId'],
    properties: {
      projectId: { type: 'string', format: 'uuid' },
      environment: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        pattern: '^\\s*[A-Za-z0-9][A-Za-z0-9._-]*\\s*$',
      },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      offset: { type: 'integer', minimum: 0, default: 0 },
      from: { type: 'string', format: 'date-time' },
      to: { type: 'string', format: 'date-time' },
      fingerprint: { type: 'string', minLength: 1, maxLength: 128 },
      errorType: { type: 'string', minLength: 1, maxLength: 100 },
      resolved: { type: 'boolean' },
    },
  },
};

export const ErrorByIdSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['errorId'],
    properties: {
      errorId: { type: 'string', format: 'uuid' },
    },
  },
  querystring: {
    type: 'object',
    required: ['projectId'],
    properties: {
      projectId: { type: 'string', format: 'uuid' },
    },
  },
};
