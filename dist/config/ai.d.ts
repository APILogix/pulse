export interface AIConfig {
    enabled: boolean;
    apiKey?: string;
    primaryModel: string;
    fallbackModel: string;
    embeddingModel: string;
    timeoutMs: number;
    maxRetries: number;
    circuitFailureThreshold: number;
    circuitResetMs: number;
    maxInputChars: number;
    maxOutputTokens: number;
    maxRetrievalChunks: number;
    cacheTtlSeconds: number;
    rateLimitPerMinute: number;
    maxConcurrentJobsPerTenant: number;
    maxConcurrentChatPerTenant: number;
}
/**
 * Centralized, immutable AI runtime configuration. Provider credentials never
 * leave this module and are never copied into prompts, metadata, or logs.
 */
export declare const aiConfig: AIConfig;
//# sourceMappingURL=ai.d.ts.map