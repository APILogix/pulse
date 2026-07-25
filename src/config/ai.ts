import { env } from './env.js';

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
export const aiConfig: AIConfig = Object.freeze({
  enabled: env.AI_ENABLED === true && Boolean(env.OPENAI_API_KEY),
  ...(env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {}),
  primaryModel: env.AI_PRIMARY_MODEL,
  fallbackModel: env.AI_FALLBACK_MODEL,
  embeddingModel: env.AI_EMBEDDING_MODEL,
  timeoutMs: env.AI_PROVIDER_TIMEOUT_MS,
  maxRetries: env.AI_PROVIDER_MAX_RETRIES,
  circuitFailureThreshold: env.AI_CIRCUIT_FAILURE_THRESHOLD,
  circuitResetMs: env.AI_CIRCUIT_RESET_MS,
  maxInputChars: env.AI_MAX_INPUT_CHARS,
  maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
  maxRetrievalChunks: env.AI_MAX_RETRIEVAL_CHUNKS,
  cacheTtlSeconds: env.AI_CACHE_TTL_SECONDS,
  rateLimitPerMinute: env.AI_RATE_LIMIT_PER_MINUTE,
  maxConcurrentJobsPerTenant: env.AI_MAX_CONCURRENT_JOBS_PER_TENANT,
  maxConcurrentChatPerTenant: env.AI_MAX_CONCURRENT_CHAT_PER_TENANT,
});
