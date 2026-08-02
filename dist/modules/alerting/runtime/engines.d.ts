import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { type AlertRuntimeTier } from './rule-catalog.js';
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
}
export declare class AlertRuntimeEngines {
    private readonly logDb;
    private readonly controlDb;
    private readonly catalog;
    private readonly runtime;
    private readonly log;
    constructor(logger: FastifyBaseLogger, logDb: Pool, controlDb: Pool);
    evaluateFast(input: FastEvaluationInput): Promise<RuntimeEvaluationSummary>;
    evaluateTier(input: TierEvaluationInput): Promise<RuntimeEvaluationSummary>;
    private evaluateCandidate;
    private appendDecision;
    private enqueueNotificationJob;
    private resolveConnectorTargets;
    private loadRollupScopes;
    private loadWindowScopes;
    private loadOperationalScopes;
    private loadAiScopes;
}
//# sourceMappingURL=engines.d.ts.map