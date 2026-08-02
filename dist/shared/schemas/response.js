export const ApiResponseSchema = {
    response: {
        200: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                data: { type: 'object' },
            },
        },
        201: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                data: { type: 'object' },
            },
        },
        204: {
            description: 'No content',
        },
        400: {
            type: 'object',
            properties: {
                statusCode: { type: 'number' },
                message: { type: 'string' },
                errors: { type: 'array' },
            },
        },
        401: {
            type: 'object',
            properties: {
                error: {
                    type: 'object',
                    properties: {
                        code: { type: 'string' },
                        message: { type: 'string' },
                    },
                },
            },
        },
        403: {
            type: 'object',
            properties: {
                error: {
                    type: 'object',
                    properties: {
                        code: { type: 'string' },
                        message: { type: 'string' },
                    },
                },
            },
        },
        404: {
            type: 'object',
            properties: {
                error: {
                    type: 'object',
                    properties: {
                        code: { type: 'string' },
                        message: { type: 'string' },
                    },
                },
            },
        },
        429: {
            type: 'object',
            properties: {
                statusCode: { type: 'number' },
                error: { type: 'string' },
                message: { type: 'string' },
            },
        },
        500: {
            type: 'object',
            properties: {
                statusCode: { type: 'number' },
                message: { type: 'string' },
                requestId: { type: 'string' },
            },
        },
    },
};
export const PaginatedResponseSchema = {
    response: {
        200: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                data: { type: 'array' },
                meta: {
                    type: 'object',
                    properties: {
                        total: { type: 'number' },
                        limit: { type: 'number' },
                        offset: { type: 'number' },
                        hasMore: { type: 'boolean' },
                        nextCursor: { type: ['string', 'null'] },
                    },
                },
            },
        },
    },
};
export const HealthResponseSchema = {
    response: {
        200: {
            type: 'object',
            properties: {
                status: { type: 'string' },
                timestamp: { type: 'string' },
                uptime: { type: 'number' },
                version: { type: 'string' },
            },
        },
        503: {
            type: 'object',
            properties: {
                status: { type: 'string' },
                checks: { type: 'object' },
            },
        },
    },
};
//# sourceMappingURL=response.js.map