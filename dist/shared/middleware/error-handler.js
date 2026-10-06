import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ERROR_CODES } from '../errors/error-codes.js';
const errorLogger = logger.child({ component: 'error-handler' });
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function publicCode(error, statusCode) {
    if (typeof error.code === 'string' && !error.code.startsWith('FST_')) {
        return error.code;
    }
    if (statusCode === 400)
        return ERROR_CODES.VALIDATION_ERROR.code;
    if (statusCode === 401)
        return ERROR_CODES.AUTHENTICATION_REQUIRED.code;
    if (statusCode === 403)
        return ERROR_CODES.FORBIDDEN.code;
    if (statusCode === 404)
        return ERROR_CODES.NOT_FOUND.code;
    if (statusCode === 409)
        return ERROR_CODES.RESOURCE_CONFLICT.code;
    if (statusCode === 422)
        return ERROR_CODES.BUSINESS_RULE_VIOLATION.code;
    if (statusCode === 429)
        return ERROR_CODES.RATE_LIMIT_EXCEEDED.code;
    if (statusCode === 502)
        return ERROR_CODES.UPSTREAM_ERROR.code;
    if (statusCode === 503)
        return ERROR_CODES.SERVICE_UNAVAILABLE.code;
    if (statusCode === 504)
        return ERROR_CODES.UPSTREAM_TIMEOUT.code;
    return ERROR_CODES.INTERNAL_ERROR.code;
}
function publicMessage(error, statusCode) {
    if (statusCode >= 500 && env.NODE_ENV !== 'development') {
        return ERROR_CODES.INTERNAL_ERROR.message;
    }
    if (typeof error.message === 'string' && error.message.length > 0) {
        return error.message;
    }
    return statusCode >= 500 ? ERROR_CODES.INTERNAL_ERROR.message : 'Request failed';
}
function formatValidationDetails(validation, isZod) {
    if (!validation)
        return null;
    if (isZod && Array.isArray(validation)) {
        const fields = {};
        for (const issue of validation) {
            if (isRecord(issue) && Array.isArray(issue.path) && typeof issue.message === 'string') {
                const fieldName = issue.path.join('.') || 'root';
                fields[fieldName] = issue.message;
            }
        }
        return Object.keys(fields).length > 0 ? { fields } : { raw: validation };
    }
    if (isRecord(validation)) {
        return validation;
    }
    return { details: validation };
}
export function errorHandler(error, request, reply) {
    if (reply.sent) {
        return reply;
    }
    const err = error;
    const isDev = env.NODE_ENV === 'development';
    const isZodError = err.name === 'ZodError';
    const rawValidation = err.validation ?? (isZodError ? err.issues : undefined);
    const statusCode = isZodError || err.code === 'FST_ERR_VALIDATION'
        ? 400
        : err.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
            ? 413
            : Math.min(Math.max(err.statusCode ?? 500, 400), 599);
    const requestId = request.id || reply.getHeader('x-request-id') || 'req_unknown';
    const logPayload = {
        err,
        requestId,
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
    const code = publicCode(err, statusCode);
    const message = publicMessage(err, statusCode);
    let details = null;
    if (rawValidation !== undefined) {
        details = formatValidationDetails(rawValidation, isZodError);
    }
    else if (statusCode < 500 && isRecord(err.details)) {
        details = err.details;
    }
    const responseBody = {
        success: false,
        data: null,
        error: {
            code,
            message,
            details,
        },
        meta: null,
        requestId,
    };
    return reply.status(statusCode).send(responseBody);
}
//# sourceMappingURL=error-handler.js.map