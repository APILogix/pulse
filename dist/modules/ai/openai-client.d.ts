import type { FastifyBaseLogger } from 'fastify';
import type { AIConfig } from '../../config/ai.js';
import type { AIMode } from './types.js';
export interface ModelRoute {
    primaryModel: string;
    fallbackModel: string | null;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
}
export interface ProviderCompletion {
    content: string;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    fallbackUsed: boolean;
}
export interface AIProvider {
    readonly available: boolean;
    complete(systemPrompt: string, userPrompt: string, route: ModelRoute, mode: AIMode | 'AI_MONITORING_CHAT'): Promise<ProviderCompletion>;
    embed(text: string): Promise<number[] | null>;
}
export declare class ProviderUnavailableError extends Error {
}
export declare class ProviderCircuitOpenError extends Error {
}
export declare class OpenAIProvider implements AIProvider {
    private readonly config;
    private readonly logger;
    private readonly client;
    private consecutiveFailures;
    private circuitOpenedAt;
    constructor(config: AIConfig, logger: FastifyBaseLogger);
    get available(): boolean;
    private assertAvailable;
    private recordFailure;
    private invoke;
    complete(systemPrompt: string, userPrompt: string, route: ModelRoute, _mode: AIMode | 'AI_MONITORING_CHAT'): Promise<ProviderCompletion>;
    embed(text: string): Promise<number[] | null>;
}
//# sourceMappingURL=openai-client.d.ts.map