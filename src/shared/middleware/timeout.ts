/**
 * Request timeout middleware.
 *
 * Aborts requests that exceed the configured timeout to prevent
 * resource exhaustion and hanging connections.
 */
import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';

export interface TimeoutOptions {
  timeoutMs: number;
  errorMessage?: string;
  errorCode?: string;
}

const DEFAULT_TIMEOUT_MS = 30000;

export function createTimeoutMiddleware(options: TimeoutOptions = { timeoutMs: DEFAULT_TIMEOUT_MS }) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    errorMessage = 'Request timeout',
    errorCode = 'REQUEST_TIMEOUT',
  } = options;

  return async (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
    const timeout = setTimeout(() => {
      if (!reply.sent) {
        request.log.warn({ timeoutMs }, 'Request timed out');
        reply.status(408).send({
          statusCode: 408,
          error: errorCode,
          message: errorMessage,
        });
      }
    }, timeoutMs);

    reply.raw.on('finish', () => {
      clearTimeout(timeout);
    });

    reply.raw.on('close', () => {
      clearTimeout(timeout);
    });

    done();
  };
}
