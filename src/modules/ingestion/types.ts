import  type { FastifySchema } from 'fastify';

/** SDK Event Types - Matches exactly what SDK sends */
export type EventType = 'request' | 'error' | 'log' | 'metric' | 'custom';

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
  metadata?: Record<string, any>;
}

/** SDK Metric Event Payload */
export interface SDKMetricEvent {
  type: 'metric';
  name: string;
  value: number;
  unit?: string;
  tags?: Record<string, string>;
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
  errors?: Array<{ eventId: string; reason: string }>;
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

/** Fastify Validation Schemas */
export const IngestSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['apiKey', 'events'],
    properties: {
      apiKey: { type: 'string', minLength: 32, maxLength: 128 },
      events: {
        type: 'array',
        maxItems: 1000,
        items: {
          type: 'object',
          required: ['type', 'timestamp'],
          properties: {
            type: { 
              type: 'string', 
              enum: ['request', 'error', 'log', 'metric', 'custom'] 
            },
            timestamp: { type: 'number' },
            requestId: { type: 'string', format: 'uuid' },
            url: { type: 'string' },
            method: { 
              type: 'string', 
              enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'] 
            },
            statusCode: { type: 'integer' },
            latency: { type: 'integer', minimum: 0 },
            bodySize: { type: 'integer', minimum: 0 },
            userId: { type: ['string', 'null'] },
            message: { type: 'string' },
            fingerprint: { type: 'string' },
            stack: { type: 'array', items: { type: 'string' } },
            context: { type: 'object' },
            level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
            name: { type: 'string' },
            headers: { type: 'object' },
            query: { type: 'object' },
          }
        }
      },
      metadata: { type: 'object' }
    }
  }
};

export const InitSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['apiKey'],
    properties: {
      apiKey: { type: 'string', minLength: 32 }
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
      eventTypes: { 
        type: 'array', 
        items: { type: 'string', enum: ['request', 'error', 'log', 'metric', 'custom'] }
      },
      targetQueue: { type: 'string', default: 'ingestion' }
    }
  }
};