import type { PoolClient } from "pg";
import type { UpdateAlertPreferenceBody, ProjectMemberAlertPreference } from "./alert-preferences.types.js";
export declare class AlertPreferencesRepository {
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    private mapRow;
    getPreferences(projectId: string, userId: string): Promise<ProjectMemberAlertPreference[]>;
    createPreference(projectId: string, userId: string, routeId: string, client?: PoolClient): Promise<ProjectMemberAlertPreference>;
    updatePreference(prefId: string, projectId: string, userId: string, dto: UpdateAlertPreferenceBody): Promise<ProjectMemberAlertPreference>;
    bulkSubscribe(projectId: string, routeId: string, userIds: string[], client?: PoolClient): Promise<void>;
    resolveRecipients(projectId: string, routeId: string, severity: string): Promise<string[]>;
}
//# sourceMappingURL=alert-preferences.repository.d.ts.map