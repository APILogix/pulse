import type { FastifyBaseLogger } from 'fastify';
import { ConnectorService } from '../../service.js';
import { ConnectorRepository } from '../../repository.js';
export interface SlackServiceDeps {
    repository: ConnectorRepository;
    connectorService: ConnectorService;
    logger: FastifyBaseLogger;
}
export declare class SlackService {
    private readonly deps;
    constructor(deps: SlackServiceDeps);
    startOAuth(orgId: string, actorUserId: string, actorIp: string, actorUserAgent: string): Promise<{
        url: string;
        connectorId: string;
    }>;
    handleCallback(code: string, state: string): Promise<{
        connectorId: any;
        orgId: any;
    }>;
    listChannels(orgId: string, connectorId: string): Promise<{
        channels: any;
    }>;
}
//# sourceMappingURL=slack.service.d.ts.map