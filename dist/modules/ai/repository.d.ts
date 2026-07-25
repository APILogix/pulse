import type { Pool } from 'pg';
import type { AIAnswer, AIMode, CreditRulesContext } from './types.js';
import type { ModelRoute } from './openai-client.js';
export declare const MODE_FEATURE_KEYS: Record<AIMode, string>;
export declare class AIRepositoryError extends Error {
    readonly code: 'LOCKED' | 'INSUFFICIENT_CREDITS' | 'DUPLICATE_IN_PROGRESS' | 'IDEMPOTENCY_CONFLICT' | 'TOO_MANY_JOBS' | 'TOO_MANY_CHAT_REQUESTS' | 'INVALID_REQUEST' | 'NOT_FOUND';
    constructor(message: string, code: 'LOCKED' | 'INSUFFICIENT_CREDITS' | 'DUPLICATE_IN_PROGRESS' | 'IDEMPOTENCY_CONFLICT' | 'TOO_MANY_JOBS' | 'TOO_MANY_CHAT_REQUESTS' | 'INVALID_REQUEST' | 'NOT_FOUND');
}
export interface AIAuthorization {
    role: string;
    plan: string;
    entitled: boolean;
    monthlyCredits: number;
}
export interface CreditReservation {
    tenantId: string;
    requestId: string;
    idempotencyKey: string;
    mode: AIMode;
    amount: number;
    unlimited: boolean;
}
export interface ExistingResponse {
    answer: AIAnswer;
    responseId: string;
    inputHash: string;
    mode: AIMode;
}
export interface PreparedRequest {
    reservation: CreditReservation | null;
    duplicateResponse: ExistingResponse | null;
}
export interface PreparedJob {
    jobId: string;
    status: string;
    created: boolean;
}
export interface KnowledgeChunk {
    sourceId: string;
    sourceType: string;
    title: string;
    reference: string;
    content: string;
    accessLevel: string;
    version: number;
    score: number;
}
export interface AccessibleProject {
    id: string;
    name: string;
    slug: string;
    environment: string;
}
export interface StoredChatResponse {
    requestId: string;
    conversationId: string;
    response: Record<string, unknown>;
}
export interface PreparedChatRequest {
    requestId: string;
    conversationId: string;
    replay: StoredChatResponse | null;
}
export interface ChatToolCallRecord {
    invocationId: string;
    toolName: string;
    projectId: string | null;
    arguments: Record<string, unknown>;
    result: unknown;
    durationMs: number;
    status: 'success' | 'failed';
}
export declare class AIRepository {
    private readonly db;
    constructor(db?: Pool);
    private transaction;
    private authorizeFeature;
    authorize(tenantId: string, userId: string, mode: AIMode): Promise<AIAuthorization>;
    authorizeMonitoringChat(tenantId: string, userId: string): Promise<AIAuthorization>;
    getAccessibleProjects(tenantId: string, userId: string, requestedProjectId?: string): Promise<AccessibleProject[]>;
    resolveCreditRules(tenantId: string, plan: string, mode: AIMode): Promise<CreditRulesContext>;
    resolveModelRoute(tenantId: string, plan: string, mode: AIMode, defaults: ModelRoute): Promise<ModelRoute>;
    getCached(tenantId: string, cacheKey: string): Promise<AIAnswer | null>;
    getExistingAnswer(tenantId: string, idempotencyKey: string): Promise<ExistingResponse | null>;
    prepareRequest(input: {
        tenantId: string;
        userId: string;
        requestId: string;
        idempotencyKey: string;
        mode: AIMode;
        inputHash: string;
        cacheKey: string;
        cost: number;
        monthlyCredits: number;
    }): Promise<PreparedRequest>;
    adjustReservation(reservation: CreditReservation, newAmount: number): Promise<CreditReservation>;
    releaseReservation(reservation: CreditReservation, reason: string): Promise<void>;
    finalizeReservation(reservation: CreditReservation, usage: {
        provider: string;
        model: string;
        promptTokens: number;
        completionTokens: number;
        latencyMs: number;
    }): Promise<void>;
    private claimUsage;
    private insertUsage;
    recordSuccessfulUsage(input: {
        tenantId: string;
        userId: string;
        requestId: string;
        mode: AIMode;
        cached: boolean;
        usage: {
            provider: string;
            model: string;
            promptTokens: number;
            completionTokens: number;
            latencyMs: number;
        };
    }): Promise<void>;
    persistAnswer(input: {
        tenantId: string;
        userId: string;
        requestId: string;
        answer: AIAnswer;
        cacheKey: string | null;
        cacheTtlSeconds: number;
        provider: string;
        model: string;
        latencyMs: number;
        promptTokens: number;
        completionTokens: number;
        promptVersion: string;
    }): Promise<string>;
    getKnowledgeVersion(tenantId: string): Promise<string>;
    retrieveKnowledge(input: {
        tenantId: string;
        role: string;
        query: string;
        embedding: number[] | null;
        limit: number;
        serviceName?: string;
        environmentName?: string;
        severity?: string;
        includeGlobal?: boolean;
    }): Promise<KnowledgeChunk[]>;
    prepareChatRequest(input: {
        tenantId: string;
        userId: string;
        idempotencyKey: string;
        inputHash: string;
        question: string;
        conversationId?: string;
        projectId?: string;
        maxConcurrentRequests: number;
    }): Promise<PreparedChatRequest>;
    getChatHistory(tenantId: string, userId: string, conversationId: string): Promise<Array<{
        role: string;
        content: string;
    }>>;
    recordChatToolCalls(tenantId: string, requestId: string, calls: ChatToolCallRecord[]): Promise<void>;
    completeChatRequest(input: {
        tenantId: string;
        userId: string;
        requestId: string;
        conversationId: string;
        response: Record<string, unknown>;
        assistantContent: string;
        provider: string;
        model: string;
        promptTokens: number;
        completionTokens: number;
        latencyMs: number;
    }): Promise<void>;
    failChatRequest(tenantId: string, requestId: string, response: Record<string, unknown>): Promise<void>;
    confirmChatUsage(tenantId: string, requestId: string): Promise<boolean>;
    reconcilePendingChatUsage(limit?: number): Promise<number>;
    saveFeedback(input: {
        tenantId: string;
        userId: string;
        responseId: string;
        rating?: number;
        helpful?: boolean;
        correction?: string;
        comment?: string;
    }): Promise<string>;
    createJob(input: {
        tenantId: string;
        userId: string;
        mode: AIMode;
        inputHash: string;
        encryptedInput: string;
        idempotencyKey: string;
        maxConcurrentJobs: number;
    }): Promise<PreparedJob>;
    attachQueueJob(jobId: string, tenantId: string, queueJobId: string): Promise<void>;
    loadJob(jobId: string): Promise<{
        jobId: string;
        tenantId: string;
        userId: string;
        mode: AIMode;
        encryptedInput: string;
    } | null>;
    finishJob(jobId: string, responseId: string): Promise<void>;
    failJob(jobId: string, error: string): Promise<void>;
    getJob(tenantId: string, jobId: string, userId: string): Promise<Record<string, unknown> | null>;
    refundCredits(input: {
        tenantId: string;
        actorUserId: string;
        requestId: string;
        idempotencyKey: string;
        mode: AIMode;
        amount: number;
        reason: string;
    }): Promise<boolean>;
    releaseStaleReservations(): Promise<number>;
    markRequestFailed(requestId: string, tenantId: string, status: string): Promise<void>;
    recordGovernanceEvent(input: {
        tenantId: string;
        userId: string;
        requestId: string;
        action: string;
        outcome: 'success' | 'failure';
        metadata?: Record<string, unknown>;
    }): Promise<void>;
}
//# sourceMappingURL=repository.d.ts.map