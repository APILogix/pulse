import type { Pool, PoolClient } from "pg";
import type { CreateProjectAlertChannelBody, ImmediateDeliveryRequest, ImmediateDeliveryTarget, ListProjectAlertChannelsQuery, ProjectAlertChannel, ProjectMemberAlertChannelPreference, UpsertMemberAlertChannelPreferenceBody, UpdateProjectAlertChannelBody } from "./channel.types.js";
type DbClient = Pool | PoolClient;
export interface ActiveConnectorReference {
    id: string;
    provider: string;
}
export declare class AlertChannelRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    list(organizationId: string, projectId: string, query: ListProjectAlertChannelsQuery, client?: DbClient): Promise<{
        channels: ProjectAlertChannel[];
        total: number;
    }>;
    findById(organizationId: string, projectId: string, channelId: string, client?: DbClient, forUpdate?: boolean): Promise<ProjectAlertChannel | null>;
    requireActiveConnector(organizationId: string, connectorId: string, client?: DbClient): Promise<ActiveConnectorReference>;
    lockDefaultGroups(projectId: string, _channelTypes: readonly string[], client: PoolClient): Promise<void>;
    hasEnabledDefault(projectId: string, channelType: string, client: DbClient): Promise<boolean>;
    unsetEnabledDefaults(projectId: string, channelType: string, exceptChannelId: string | null, updatedBy: string, client: DbClient): Promise<void>;
    create(organizationId: string, projectId: string, userId: string, body: CreateProjectAlertChannelBody, isDefault: boolean, client: DbClient): Promise<ProjectAlertChannel>;
    update(organizationId: string, projectId: string, channelId: string, userId: string, body: UpdateProjectAlertChannelBody, isDefault: boolean, client: DbClient): Promise<ProjectAlertChannel>;
    ensureEnabledDefault(organizationId: string, projectId: string, channelType: string, updatedBy: string, client: DbClient): Promise<void>;
    softDelete(organizationId: string, projectId: string, channelId: string, userId: string, client: DbClient): Promise<void>;
    listMemberPreferences(organizationId: string, projectId: string, userId: string, client?: DbClient): Promise<ProjectMemberAlertChannelPreference[]>;
    upsertMemberPreference(organizationId: string, projectId: string, userId: string, channelId: string, body: UpsertMemberAlertChannelPreferenceBody, client?: DbClient): Promise<ProjectMemberAlertChannelPreference>;
    softDeleteMemberPreference(organizationId: string, projectId: string, userId: string, channelId: string, category: string, client?: DbClient): Promise<void>;
    resolveImmediateDeliveryTargets(request: ImmediateDeliveryRequest, client?: DbClient): Promise<ImmediateDeliveryTarget[]>;
    private mapChannel;
    private mapPreference;
}
export {};
//# sourceMappingURL=channel.repository.d.ts.map