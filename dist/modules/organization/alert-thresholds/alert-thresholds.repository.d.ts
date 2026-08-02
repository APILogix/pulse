import { BaseRepository } from "../shared/base.repository.js";
import type { AlertThresholdRow } from "../types.js";
export declare class AlertThresholdsRepository extends BaseRepository {
    private static readonly ALERT_THRESHOLD_COLS;
    getAlertThresholds(orgId: string, projectId: string | null): Promise<AlertThresholdRow | null>;
    listAlertThresholds(orgId: string): Promise<AlertThresholdRow[]>;
    upsertAlertThresholds(orgId: string, projectId: string | null, data: Record<string, unknown>, createdBy: string): Promise<AlertThresholdRow>;
    markAlertThresholdFired(id: string): Promise<void>;
    getOrgFallbackEmail(orgId: string): Promise<string | null>;
}
//# sourceMappingURL=alert-thresholds.repository.d.ts.map