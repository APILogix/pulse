/** Fastify Validation Schemas */
export const IngestSchema = {
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
export const InitSchema = {
    body: {
        type: 'object',
        required: ['apiKey'],
        properties: {
            apiKey: { type: 'string', minLength: 32 }
        }
    }
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
                items: { type: 'string', enum: ['request', 'error', 'log', 'metric', 'custom'] }
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