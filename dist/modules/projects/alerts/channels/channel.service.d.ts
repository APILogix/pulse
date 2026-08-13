import type { FastifyBaseLogger } from "fastify";
import type { ProjectsService, RequestMeta } from "../../service.js";
import { NotificationEntitlementService } from "../../../alerting/runtime/notification-entitlement.service.js";
import { AlertChannelRepository } from "./channel.repository.js";
import type { CreateProjectAlertChannelBody, DeleteMemberAlertChannelPreferenceQuery, ImmediateDeliveryRequest, ImmediateDeliveryTarget, ListProjectAlertChannelsQuery, ProjectAlertChannel, ProjectMemberAlertChannelPreference, ToggleProjectAlertChannelBody, UpsertMemberAlertChannelPreferenceBody, UpdateProjectAlertChannelBody } from "./channel.types.js";
export declare function containsUrlLikeValue(value: unknown): boolean;
export declare class ProjectAlertChannelService {
    private readonly repository;
    private readonly projectsService;
    private readonly logger;
    private readonly entitlement;
    constructor(repository: AlertChannelRepository, projectsService: ProjectsService, logger: FastifyBaseLogger, entitlement?: NotificationEntitlementService);
    list(orgId: string, projectId: string, userId: string, query: ListProjectAlertChannelsQuery): Promise<{
        channels: ProjectAlertChannel[];
        total: number;
        limit: number;
        offset: number;
    }>;
    get(orgId: string, projectId: string, channelId: string, userId: string): Promise<ProjectAlertChannel>;
    create(orgId: string, projectId: string, userId: string, body: CreateProjectAlertChannelBody, meta: RequestMeta): Promise<ProjectAlertChannel>;
    update(orgId: string, projectId: string, channelId: string, userId: string, body: UpdateProjectAlertChannelBody, meta: RequestMeta): Promise<ProjectAlertChannel>;
    toggle(orgId: string, projectId: string, channelId: string, userId: string, body: ToggleProjectAlertChannelBody, meta: RequestMeta): Promise<ProjectAlertChannel>;
    delete(orgId: string, projectId: string, channelId: string, userId: string, meta: RequestMeta): Promise<void>;
    listMyPreferences(orgId: string, projectId: string, userId: string): Promise<ProjectMemberAlertChannelPreference[]>;
    upsertMyPreference(orgId: string, projectId: string, channelId: string, userId: string, body: UpsertMemberAlertChannelPreferenceBody, meta: RequestMeta): Promise<ProjectMemberAlertChannelPreference>;
    deleteMyPreference(orgId: string, projectId: string, channelId: string, userId: string, query: DeleteMemberAlertChannelPreferenceQuery, meta: RequestMeta): Promise<void>;
    /** Internal authoritative lookup; callers must provide tenant-scoped event data. */
    resolveImmediateDeliveryTargets(request: ImmediateDeliveryRequest): Promise<ImmediateDeliveryTarget[]>;
    private assertSafeWebhookConfiguration;
    private assertConnectorConfigurationAllowed;
    private audit;
}
//# sourceMappingURL=channel.service.d.ts.map