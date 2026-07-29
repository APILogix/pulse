/**
 * Project alert delivery + dead-letter service.
 *
 * Every operation is authorised through requireProjectAccess. Reads require
 * VIEWER; reprocess/discard/purge mutate delivery state and require EDITOR.
 */
import type { FastifyBaseLogger } from "fastify";
import { BaseProjectService } from "../../shared/base.service.js";
import type { DeliveryLogRepository } from "./delivery-log.repository.js";
export interface AlertDeliveryDto {
    id: string;
    timestamp: number;
    routeName: string;
    connectorType: string;
    status: string;
    severity: string;
    attempts: number;
    latency: number | null;
}
export interface DeadLetterDto {
    id: string;
    timestamp: number;
    routeName: string;
    target: string;
    reason: string;
    payloadSize: string;
}
export declare class DeliveryLogService {
    private readonly repository;
    private readonly base;
    private readonly logger;
    constructor(repository: DeliveryLogRepository, base: BaseProjectService, logger: FastifyBaseLogger);
    private toDeliveryDto;
    private toDeadLetterDto;
    listDeliveries(orgId: string, projectId: string, userId: string, filters: {
        status?: string | undefined;
        severity?: string | undefined;
        limit: number;
        offset: number;
    }): Promise<{
        data: AlertDeliveryDto[];
        total: number;
    }>;
    listDeadLetters(orgId: string, projectId: string, userId: string, filters: {
        limit: number;
        offset: number;
    }): Promise<{
        data: DeadLetterDto[];
        total: number;
    }>;
    reprocessDeadLetter(orgId: string, projectId: string, userId: string, deliveryId: string): Promise<boolean>;
    reprocessAll(orgId: string, projectId: string, userId: string): Promise<number>;
    discardDeadLetter(orgId: string, projectId: string, userId: string, deliveryId: string): Promise<boolean>;
    purgeQueue(orgId: string, projectId: string, userId: string): Promise<number>;
}
//# sourceMappingURL=delivery-log.service.d.ts.map