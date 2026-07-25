import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
const errorLogger = logger.child({ component: 'error-handler' });
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function publicCode(error, statusCode) {
    if (typeof error.code === 'string' && !error.code.startsWith('FST_')) {
        return error.code;
    }
    if (statusCode === 400)
        return 'VALIDATION_ERROR';
    if (statusCode === 401)
        return 'UNAUTHORIZED';
    if (statusCode === 403)
        return 'FORBIDDEN';
    if (statusCode === 404)
        return 'NOT_FOUND';
    if (statusCode === 413)
        return 'PAYLOAD_TOO_LARGE';
    if (statusCode === 429)
        return 'RATE_LIMITED';
    return 'INTERNAL_ERROR';
}
function publicMessage(error, statusCode) {
    if (statusCode >= 500 && env.NODE_ENV !== 'development') {
        return 'Internal Server Error';
    }
    if (typeof error.message === 'string' && error.message.length > 0) {
        return error.message;
    }
    return statusCode >= 500 ? 'Internal Server Error' : 'Request failed';
}
export function errorHandler(error, request, reply) {
    const err = error;
    const isDev = env.NODE_ENV === 'development';
    const isZodError = err.name === 'ZodError';
    const validationDetails = err.validation ?? (isZodError ? err.issues : undefined);
    const statusCode = isZodError || err.code === 'FST_ERR_VALIDATION'
        ? 400
        : err.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
            ? 413
            : Math.min(Math.max(err.statusCode ?? 500, 400), 599);
    const logPayload = {
        err,
        requestId: request.id,
        method: request.method,
        url: request.url,
        statusCode,
    };
    if (statusCode >= 500) {
        errorLogger.error(logPayload, 'Unhandled request error');
    }
    else {
        errorLogger.warn(logPayload, 'Request rejected');
    }
    const responseError = {
        code: publicCode(err, statusCode),
        message: publicMessage(err, statusCode),
    };
    if (validationDetails !== undefined) {
        responseError.details = { validation: validationDetails };
    }
    else if (statusCode < 500 && isRecord(err.details)) {
        responseError.details = err.details;
    }
    if (isDev && err.stack) {
        responseError.stack = err.stack;
    }
    return reply.status(statusCode).send({
        error: responseError,
        request_id: request.id,
    });
}
//# sourceMappingURL=error-handler.js.map