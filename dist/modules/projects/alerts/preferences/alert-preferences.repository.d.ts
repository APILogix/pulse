import type { Pool, PoolClient } from "pg";
import type { UpdateAlertPreferenceBody, ProjectMemberNotificationPreference, ProjectNotificationPreference, NotificationChannel } from "./alert-preferences.types.js";
type DbClient = Pool | PoolClient;
export declare class AlertPreferencesRepository {
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    private mapMemberPreferenceRow;
    private mapProjectPreferenceRow;
    getMemberPreferences(organizationId: string, projectId: string, userId: string, client?: DbClient): Promise<ProjectMemberNotificationPreference[]>;
    getProjectDefaults(organizationId: string, projectId: string, client?: DbClient): Promise<ProjectNotificationPreference[]>;
    createMemberPreference(organizationId: string, projectId: string, userId: string, channel: NotificationChannel, category: string, client?: DbClient): Promise<ProjectMemberNotificationPreference>;
    updateMemberPreference(prefId: string, organizationId: string, projectId: string, userId: string, dto: UpdateAlertPreferenceBody, client?: DbClient): Promise<ProjectMemberNotificationPreference>;
    bulkSubscribe(organizationId: string, projectId: string, channel: NotificationChannel, category: string, userIds: string[], client?: DbClient): Promise<void>;
    resolveRecipients(organizationId: string, projectId: string, category: string, severity: string, client?: DbClient): Promise<string[]>;
    seedMissingMemberPreferences(organizationId: string, projectId: string, userId: string, client?: DbClient): Promise<ProjectMemberNotificationPreference[]>;
}
export {};
//# sourceMappingURL=alert-preferences.repository.d.ts.map