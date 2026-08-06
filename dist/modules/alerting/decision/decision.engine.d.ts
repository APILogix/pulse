import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import type { EffectiveAlertPolicy } from '../policy/types.js';
import { type AlertEventV2Row, type NotificationJobRow } from '../runtime/alert-runtime.repository.js';
import { type AlertLifecycleState } from './state-machine.js';
export interface AlertDecisionCandidate {
    organizationId: string;
    projectId?: string | null;
    environment?: string | null;
    service?: string | null;
    endpoint?: string | null;
    dimension?: string | null;
    ruleRevision: number;
    policy: EffectiveAlertPolicy;
    source: string;
    observedAt: Date;
    kind?: 'fired' | 'recovered';
    observedValue?: number | null;
    thresholdValue?: number | null;
    evidence?: Record<string, unknown>;
    labels?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
}
export interface AlertDecisionResult {
    alertKey: string;
    duplicate: boolean;
    suppressed: boolean;
    state: AlertLifecycleState;
    event: AlertEventV2Row | null;
    notificationJobs: NotificationJobRow[];
}
export declare function alertFingerprint(candidate: Pick<AlertDecisionCandidate, 'organizationId' | 'projectId' | 'policy' | 'environment' | 'service' | 'endpoint' | 'dimension'>): string;
export declare class AlertDecisionEngine {
    private readonly runtime;
    private readonly log;
    constructor(logDb: Pool, logger: FastifyBaseLogger);
    decide(candidate: AlertDecisionCandidate): Promise<AlertDecisionResult>;
}
//# sourceMappingURL=decision.engine.d.ts.map