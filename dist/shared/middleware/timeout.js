const DEFAULT_TIMEOUT_MS = 30000;
export function createTimeoutMiddleware(options = { timeoutMs: DEFAULT_TIMEOUT_MS }) {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, errorMessage = 'Request timeout', errorCode = 'REQUEST_TIMEOUT', } = options;
    return async (request, reply, done) => {
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
//# sourceMappingURL=timeout.js.map