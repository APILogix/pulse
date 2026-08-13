import type { FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES, type ApiErrorCode } from '../errors/error-codes.js';

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

export function getRequestId(reply: FastifyReply): string {
  const req = reply.request as FastifyRequest & { id?: string };
  return (
    req.id ||
    (reply.getHeader('x-request-id') as string) ||
    'req_unknown'
  );
}

/**
 * Standard HTTP 2xx Canonical Success Response
 */
export function successResponse<T>(
  reply: FastifyReply,
  data: T,
  message: string | null = null,
  meta: ApiMeta | null = null,
  statusCode = 200
): FastifyReply {
  const requestId = getRequestId(reply);
  const body: ApiSuccessResponse<T> = {
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
export function paginatedResponse<T>(
  reply: FastifyReply,
  data: T[],
  page: number,
  pageSize: number,
  total: number,
  message: string | null = null
): FastifyReply {
  const totalPages = Math.ceil(total / (pageSize > 0 ? pageSize : 1));
  const meta: ApiMeta = {
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
export function noContentResponse(reply: FastifyReply): FastifyReply {
  return reply.status(204).send();
}

/**
 * Standard Canonical Error Response
 */
export function errorResponse(
  reply: FastifyReply,
  code: string = ERROR_CODES.INTERNAL_ERROR.code,
  message: string = ERROR_CODES.INTERNAL_ERROR.message,
  statusCode = 500,
  details: unknown | null = null,
  meta: ApiMeta | null = null
): FastifyReply {
  const requestId = getRequestId(reply);
  const body: ApiErrorResponse = {
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
