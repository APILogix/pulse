/**
 * Project connector subscription business service.
 *
 * Flow:
 * 1. Authorize via project membership (tenant isolation + role gating).
 * 2. Enforce business rules: only admins can manage subscriptions; connectors
 *    are organization-owned resources that projects subscribe to.
 * 3. Persist mutations and write immutable audit records.
 */
import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "../../../organization/repository.js";
import { BaseProjectService } from "../../shared/base.service.js";
import { ConnectorSubscriptionRepository } from "./connector-subscription.repository.js";
import type { CreateProjectConnectorSubscriptionBody, ListProjectConnectorSubscriptionsQuery, ProjectConnectorSubscription, UpdateProjectConnectorSubscriptionBody, AlertRoutingTarget } from "./connector-subscription.types.js";
import type { RequestMeta } from "../../service.js";
export declare class ProjectConnectorSubscriptionService {
    private readonly repository;
    private readonly authService;
    private readonly orgRepo;
    private readonly logger;
    constructor(repository: ConnectorSubscriptionRepository, authService: BaseProjectService, orgRepo: OrganizationRepository, logger: FastifyBaseLogger);
    list(orgId: string, projectId: string, userId: string, query: ListProjectConnectorSubscriptionsQuery): Promise<{
        subscriptions: ProjectConnectorSubscription[];
        total: number;
        limit: number;
        offset: number;
    }>;
    get(orgId: string, projectId: string, subscriptionId: string, userId: string): Promise<ProjectConnectorSubscription>;
    create(orgId: string, projectId: string, userId: string, body: CreateProjectConnectorSubscriptionBody, meta: RequestMeta): Promise<ProjectConnectorSubscription>;
    update(orgId: string, projectId: string, subscriptionId: string, userId: string, body: UpdateProjectConnectorSubscriptionBody, meta: RequestMeta): Promise<ProjectConnectorSubscription>;
    delete(orgId: string, projectId: string, subscriptionId: string, userId: string, meta: RequestMeta): Promise<void>;
    /**
     * Resolve alert routing targets for an API key.
     *
     * This is the deterministic lookup: API Key -> Environment -> Project ->
     * Project Connector Subscriptions -> Project Members.
     */
    resolveRoutingTarget(apiKeyId: string): Promise<AlertRoutingTarget | null>;
    /**
     * Resolve alert routing targets for a project.
     *
     * Fallback for metric/ingestion alerts that are project-scoped but do not
     * carry an explicit API key.
     */
    resolveRoutingTargetByProjectId(projectId: string): Promise<AlertRoutingTarget | null>;
    private audit;
}
//# sourceMappingURL=connector-subscription.service.d.ts.map