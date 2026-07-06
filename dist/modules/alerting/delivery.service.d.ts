import type { FastifyBaseLogger } from "fastify";
import type { AlertPayload } from "./alert-router.service.js";
export interface EnqueueDeliveryPayload {
    organization_id: string;
    project_id: string;
    connector_id: string;
    route_id: string;
    severity: string;
    payload: AlertPayload;
    recipients: string[] | null;
    correlation_id: string;
}
export declare class DeliveryService {
    private readonly logger;
    constructor(logger: FastifyBaseLogger);
    enqueue(data: EnqueueDeliveryPayload): Promise<void>;
}
//# sourceMappingURL=delivery.service.d.ts.map