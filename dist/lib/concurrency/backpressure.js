/**
 * A simple backpressure tracker to reject requests if too many operations are active.
 */
export class BackpressureTracker {
    maxActive;
    activeCount = 0;
    constructor(maxActive) {
        this.maxActive = maxActive;
    }
    get active() {
        return this.activeCount;
    }
    /**
     * Acquire a slot. Returns true if acquired, false if backpressure is applied.
     */
    acquire() {
        if (this.activeCount >= this.maxActive) {
            return false;
        }
        this.activeCount++;
        return true;
    }
    release() {
        if (this.activeCount > 0) {
            this.activeCount--;
        }
    }
    /**
     * Fastify middleware pattern to enforce backpressure.
     */
    async enforce(req, reply, next) {
        if (!this.acquire()) {
            req.log.warn({ maxActive: this.maxActive, route: req.routeOptions.url }, 'Backpressure applied, shedding load');
            reply.header('Retry-After', '5');
            return reply.status(503).send({ error: 'Service Unavailable', message: 'System under heavy load, please retry later.' });
        }
        try {
            await next();
        }
        finally {
            this.release();
        }
    }
}
//# sourceMappingURL=backpressure.js.map