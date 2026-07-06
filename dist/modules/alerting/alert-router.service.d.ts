import type { FastifyBaseLogger } from "fastify";
import type { ProjectMemberAlertPreferenceService } from "../projects/alert-preferences.service.js";
import type { DeliveryService } from "./delivery.service.js";
export interface AlertPayload {
    orgId: string;
    projectId: string;
    environment: string;
    sourceService: string;
    eventType: string;
    severity: string;
    [key: string]: any;
}
export declare class AlertRouterService {
    private readonly preferenceService;
    private readonly deliveryService;
    private readonly logger;
    constructor(preferenceService: ProjectMemberAlertPreferenceService, deliveryService: DeliveryService, logger: FastifyBaseLogger);
    processAlert(payload: AlertPayload): Promise<void>;
}
//# sourceMappingURL=alert-router.service.d.ts.map