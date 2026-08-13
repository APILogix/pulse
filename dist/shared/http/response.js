import { ERROR_CODES } from '../errors/error-codes.js';
export function getRequestId(reply) {
    const req = reply.request;
    return (req.id ||
        reply.getHeader('x-request-id') ||
        'req_unknown');
}
/**
 * Standard HTTP 2xx Canonical Success Response
 */
export function successResponse(reply, data, message = null, meta = null, statusCode = 200) {
    const requestId = getRequestId(reply);
    const body = {
        success: true,
        data,
        message,
        meta,
        requestId,
    };
    return reply.status(statusCode).send(body);
}
/**
 * Standard Paginated Success Response
 */
export function paginatedResponse(reply, data, page, pageSize, total, message = null) {
    const totalPages = Math.ceil(total / (pageSize > 0 ? pageSize : 1));
    const meta = {
        pagination: {
            page,
            pageSize,
            total,
            totalPages,
        },
    };
    return successResponse(reply, data, message, meta, 200);
}
/**
 * Standard HTTP 204 No Content Response (empty body as required by HTTP spec)
 */
export function noContentResponse(reply) {
    return reply.status(204).send();
}
/**
 * Standard Canonical Error Response
 */
export function errorResponse(reply, code = ERROR_CODES.INTERNAL_ERROR.code, message = ERROR_CODES.INTERNAL_ERROR.message, statusCode = 500, details = null, meta = null) {
    const requestId = getRequestId(reply);
    const body = {
        success: false,
        data: null,
        error: {
            code,
            message,
            details,
        },
        meta,
        requestId,
    };
    return reply.status(statusCode).send(body);
}
//# sourceMappingURL=response.js.map