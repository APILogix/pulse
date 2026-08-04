import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
export declare class TelemetryOutboxRelay {
    private readonly db;
    private readonly workerId;
    private readonly log;
    constructor(db: Pool, logger: FastifyBaseLogger);
    run(limit?: number): Promise<number>;
    private claim;
    private markPublished;
    private markFailed;
}
//# sourceMappingURL=telemetry-outbox-relay.d.ts.map