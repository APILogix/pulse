import type { FastifyBaseLogger } from 'fastify';
import type { AIConfig } from '../../config/ai.js';
import { AIRepository, type CreditReservation } from './repository.js';
import type { AIProvider, ProviderCompletion } from './openai-client.js';
import { AICostTracker } from './cost-tracker.js';
import { type AIAnswer, type AIRequestInput } from './types.js';
export interface AnalysisIdentity {
    tenantId: string;
    userId: string;
    requestId?: string;
    idempotencyKey: string;
}
export interface AnalysisExecution {
    answer: AIAnswer;
    responseId: string | null;
    reservation: CreditReservation | null;
    usage: ProviderCompletion | null;
    usageContext?: {
        tenantId: string;
        userId: string;
    };
}
export declare class AIAnalyzer {
    private readonly repository;
    private readonly provider;
    private readonly config;
    private readonly logger;
    private readonly tracker;
    constructor(repository: AIRepository, provider: AIProvider, config: AIConfig, logger: FastifyBaseLogger, tracker?: AICostTracker);
    private audit;
    private static emptyAnswer;
    private cachedAnswer;
    private replayedAnswer;
    private buildUserPrompt;
    private enforceAnswer;
    analyze(rawInput: AIRequestInput, rawIdentity: AnalysisIdentity): Promise<AnalysisExecution>;
    recordFeedback(rating?: number, helpful?: boolean, correctionProvided?: boolean): void;
    confirmDelivery(execution: AnalysisExecution): Promise<void>;
    cancelDelivery(execution: AnalysisExecution, reason: string): Promise<void>;
}
//# sourceMappingURL=analyzer.d.ts.map