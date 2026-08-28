import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { AlertRuntimeRuleCatalog, type AlertRuntimeTier } from './rule-catalog.js';
import { NotificationRoutingService } from './notification-routing.service.js';
import { AlertRedisStateService } from './alert-redis-state.js';
import type { ScopedEvent } from '../../ingestion/pipeline/telemetry-writer.js';
export interface FastEvaluationInput {
    organizationId: string;
    projectId?: string | null;
    environment?: string | null;
    events?: ScopedEvent[];
    signals?: FastSignalInput[];
}
export interface FastSignalInput {
    projectId?: string | null;
    environment?: string | null;
    service?: string | null;
    endpoint?: string | null;
    source: 'deployment' | 'heartbeat' | 'connector' | 'security' | 'custom';
    kind: string;
    occurredAt?: string | Date;
    labels?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
}
export interface TierEvaluationInput {
    organizationId: string;
    tier: Exclude<AlertRuntimeTier, 'fast'>;
    maxScopes?: number;
}
export interface RuntimeEvaluationSummary {
    scopes: number;
    rules: number;
    evaluated: number;
    fired: number;
    recovered: number;
    suppressed: number;
    skipped: number;
    failed: number;
    /** Scopes skipped because their source rollup was too stale to trust. */
    stale: number;
}
export interface RuntimePayload {
    values: Record<string, unknown>;
    observedAt: Date;
    source: string;
    labels: Record<string, unknown>;
    evidence: Record<string, unknown>;
}
export declare class AlertRuntimeEngines {
    private readonly logDb;
    private readonly controlDb;
    private readonly catalog;
    private readonly runtime;
    private readonly decision;
    private readonly redisState;
    private readonly log;
    private readonly workerId;
    constructor(logger: FastifyBaseLogger, logDb: Pool, controlDb: Pool, routing?: NotificationRoutingService, redisState?: AlertRedisStateService, catalog?: AlertRuntimeRuleCatalog);
    evaluateFast(input: FastEvaluationInput): Promise<RuntimeEvaluationSummary>;
    evaluateTier(input: TierEvaluationInput): Promise<RuntimeEvaluationSummary>;
    private evaluateCandidate;
    private appendDecision;
    private enqueueNotificationJob;
    private loadRollupScopes;
    private loadWindowScopes;
    private loadOperationalScopes;
    private loadAiScopes;
}
//# sourceMappingURL=engines.d.ts.map