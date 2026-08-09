import { isEnabled } from '../../feature-flags/service.js';
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

export async function resolveAlertingRollout(
  context: AlertingRolloutContext,
): Promise<AlertingRollout> {
  const flagContext: FeatureFlagContext = {
    organizationId: context.organizationId,
    projectId: context.projectId ?? null,
  };
  const [canonicalResolution, v2Evaluation, v2Routing, v2DeliveryStatus, v2Escalation, shadowCompare] = await Promise.all([
    isEnabled(FEATURE_FLAGS.ALERTING_CANONICAL_RESOLUTION, flagContext),
    isEnabled(FEATURE_FLAGS.ALERTING_V2_EVALUATION, flagContext, false),
    isEnabled(FEATURE_FLAGS.ALERTING_V2_ROUTING, flagContext, false),
    isEnabled(FEATURE_FLAGS.ALERTING_V2_DELIVERY_STATUS, flagContext, false),
    isEnabled(FEATURE_FLAGS.ALERTING_V2_ESCALATION, flagContext, false),
    isEnabled(FEATURE_FLAGS.ALERTING_SHADOW_COMPARE, flagContext, false),
  ]);
  const [legacyThresholdWorker, legacyBatchProcessor, legacyEscalation] = await Promise.all([
    isEnabled(FEATURE_FLAGS.ALERTING_LEGACY_THRESHOLD_WORKER, flagContext, true),
    isEnabled(FEATURE_FLAGS.ALERTING_LEGACY_BATCH_PROCESSOR, flagContext, true),
    isEnabled(FEATURE_FLAGS.ALERTING_LEGACY_ESCALATION, flagContext, true),
  ]);
  return {
    canonicalResolution,
    v2Evaluation,
    v2Routing,
    v2DeliveryStatus,
    v2Escalation,
    shadowCompare,
    legacyThresholdWorker,
    legacyBatchProcessor,
    legacyEscalation,
  };
}

export async function isAlertingLegacyPathEnabled(
  key: typeof FEATURE_FLAGS.ALERTING_LEGACY_THRESHOLD_WORKER
    | typeof FEATURE_FLAGS.ALERTING_LEGACY_BATCH_PROCESSOR
    | typeof FEATURE_FLAGS.ALERTING_LEGACY_ESCALATION,
  context: AlertingRolloutContext,
): Promise<boolean> {
  return isEnabled(key, {
    organizationId: context.organizationId,
    projectId: context.projectId ?? null,
  });
}
