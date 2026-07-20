import type { Pool, PoolClient } from "pg";
import type { UpdateAlertPreferenceBody, ProjectMemberNotificationPreference, ProjectNotificationPreference, NotificationChannel } from "./alert-preferences.types.js";
type DbClient = Pool | PoolClient;
export declare class AlertPreferencesRepository {
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    private mapMemberPreferenceRow;
    private mapProjectPreferenceRow;
    getMemberPreferences(projectId: string, userId: string, client?: DbClient): Promise<ProjectMemberNotificationPreference[]>;
    getProjectDefaults(projectId: string, client?: DbClient): Promise<ProjectNotificationPreference[]>;
    createMemberPreference(projectId: string, userId: string, channel: NotificationChannel, category: string, client?: DbClient): Promise<ProjectMemberNotificationPreference>;
    updateMemberPreference(prefId: string, projectId: string, userId: string, dto: UpdateAlertPreferenceBody, client?: DbClient): Promise<ProjectMemberNotificationPreference>;
    bulkSubscribe(projectId: string, channel: NotificationChannel, category: string, userIds: string[], client?: DbClient): Promise<void>;
    resolveRecipients(projectId: string, category: string, severity: string, client?: DbClient): Promise<string[]>;
    seedMissingMemberPreferences(projectId: string, userId: string, client?: DbClient): Promise<ProjectMemberNotificationPreference[]>;
}
export {};
//# sourceMappingURL=alert-preferences.repository.d.ts.map