import type { FastifyReply } from 'fastify';
export interface PaginationMeta {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}
export interface ApiMeta {
    pagination?: PaginationMeta;
    retryAfterSeconds?: number;
    [key: string]: unknown;
}
export interface ApiSuccessResponse<T = unknown> {
    success: true;
    data: T;
    message: string | null;
    meta: ApiMeta | null;
    requestId: string;
}
export interface ApiErrorBody {
    code: string;
    message: string;
    details: unknown | null;
}
export interface ApiErrorResponse {
    success: false;
    data: null;
    error: ApiErrorBody;
    meta: ApiMeta | null;
    requestId: string;
}
export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;
export declare function getRequestId(reply: FastifyReply): string;
/**
 * Standard HTTP 2xx Canonical Success Response
 */
export declare function successResponse<T>(reply: FastifyReply, data: T, message?: string | null, meta?: ApiMeta | null, statusCode?: number): FastifyReply;
/**
 * Standard Paginated Success Response
 */
export declare function paginatedResponse<T>(reply: FastifyReply, data: T[], page: number, pageSize: number, total: number, message?: string | null): FastifyReply;
/**
 * Standard HTTP 204 No Content Response (empty body as required by HTTP spec)
 */
export declare function noContentResponse(reply: FastifyReply): FastifyReply;
/**
 * Standard Canonical Error Response
 */
export declare function errorResponse(reply: FastifyReply, code?: string, message?: string, statusCode?: number, details?: unknown | null, meta?: ApiMeta | null): FastifyReply;
//# sourceMappingURL=response.d.ts.map