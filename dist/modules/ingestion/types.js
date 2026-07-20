import { SDK_EVENT_TYPES } from './pipeline/event-normalizer.js';
/** Fastify Validation Schemas */
const sdkTypeEnum = [...SDK_EVENT_TYPES];
export const IngestSchema = {
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
                        timestamp: { type: 'number' },
                        eventId: { type: 'string', maxLength: 128 },
                        requestId: { type: 'string', maxLength: 128 },
                        metricName: { type: 'string' },
                        name: { type: 'string' },
                        metricType: { type: 'string', enum: ['counter', 'gauge', 'histogram'] },
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
                        headers: { type: 'object' },
                        query: { type: 'object' },
                    }
                }
            },
            metadata: { type: 'object' }
        }
    }
};
export const InitSchema = {
    body: {
        type: 'object',
        properties: {
            apiKey: { type: 'string', minLength: 32, maxLength: 128 },
        },
    },
};
export const ReplaySchema = {
    body: {
        type: 'object',
        required: ['projectId', 'startTime', 'endTime'],
        properties: {
            projectId: { type: 'string', format: 'uuid' },
            startTime: { type: 'string', format: 'date-time' },
            endTime: { type: 'string', format: 'date-time' },
            eventTypes: {
                type: 'array',
                items: { type: 'string', enum: sdkTypeEnum },
            },
            targetQueue: { type: 'string', default: 'ingestion' }
        }
    }
};
export const ErrorListSchema = {
    querystring: {
        type: 'object',
        required: ['projectId'],
        properties: {
            projectId: { type: 'string', format: 'uuid' },
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
export const ErrorByIdSchema = {
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
//# sourceMappingURL=types.js.map