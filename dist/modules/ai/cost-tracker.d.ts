import type { AIMode, AIResponseStatus } from './types.js';
export declare class AICostTracker {
    recordCredits(mode: AIMode, amount: number): void;
    recordRetrieval(mode: AIMode, durationMs: number, scores: number[], succeeded: boolean): void;
    recordFeedback(rating?: number, helpful?: boolean, correctionProvided?: boolean): void;
    record(input: {
        mode: AIMode;
        status: AIResponseStatus;
        durationMs: number;
        credits: number;
        promptTokens?: number;
        completionTokens?: number;
        cached?: boolean;
        fallback?: boolean;
        safetyBlocked?: boolean;
        belowThreshold?: boolean;
    }): void;
}
//# sourceMappingURL=cost-tracker.d.ts.map