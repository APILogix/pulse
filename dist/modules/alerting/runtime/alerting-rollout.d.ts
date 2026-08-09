import { FEATURE_FLAGS, type FeatureFlagContext } from '../../feature-flags/types.js';
export interface AlertingRolloutContext extends FeatureFlagContext {
    organizationId: string;
    projectId?: string | null;
}
export interface AlertingRollout {
    canonicalResolution: boolean;
    v2Evaluation: boolean;
    v2Routing: boolean;
    v2DeliveryStatus: boolean;
    v2Escalation: boolean;
    shadowCompare: boolean;
    legacyThresholdWorker: boolean;
    legacyBatchProcessor: boolean;
    legacyEscalation: boolean;
}
export declare function resolveAlertingRollout(context: AlertingRolloutContext): Promise<AlertingRollout>;
export declare function isAlertingLegacyPathEnabled(key: typeof FEATURE_FLAGS.ALERTING_LEGACY_THRESHOLD_WORKER | typeof FEATURE_FLAGS.ALERTING_LEGACY_BATCH_PROCESSOR | typeof FEATURE_FLAGS.ALERTING_LEGACY_ESCALATION, context: AlertingRolloutContext): Promise<boolean>;
//# sourceMappingURL=alerting-rollout.d.ts.map