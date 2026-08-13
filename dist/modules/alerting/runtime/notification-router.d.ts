import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { type NotificationJobStatus } from './alert-runtime.repository.js';
import { ProjectOwnerRepository } from './email-only-restricted-routing.js';
export interface NotificationRouterSummary {
    claimed: number;
    sent: number;
    queued: number;
    failed: number;
    suppressed: number;
}
export declare class AlertNotificationRouter {
    private readonly owners;
    private readonly repo;
    private readonly log;
    constructor(logDb: Pool, logger: FastifyBaseLogger, owners?: ProjectOwnerRepository);
    run(limit?: number): Promise<NotificationRouterSummary>;
    dispatchById(notificationJobId: string): Promise<NotificationJobStatus>;
    private dispatch;
    private mark;
}
//# sourceMappingURL=notification-router.d.ts.map