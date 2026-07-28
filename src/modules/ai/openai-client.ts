import OpenAI from 'openai';
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

export class ProviderUnavailableError extends Error {}
export class ProviderCircuitOpenError extends Error {}

export class OpenAIProvider implements AIProvider {
  private readonly client: OpenAI | null;
  private consecutiveFailures = 0;
  private circuitOpenedAt = 0;

  constructor(
    private readonly config: AIConfig,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.client = new OpenAI({
      apiKey: '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',
      baseURL: 'https://openrouter.ai/api/v1',
      timeout: config.timeoutMs,
      maxRetries: 0,
    });
  }

  get available(): boolean {
    return this.client !== null;
  }

  private assertAvailable(): OpenAI {
    if (!this.available || !this.client) throw new ProviderUnavailableError('AI provider is not configured');
    if (this.circuitOpenedAt > 0 && Date.now() - this.circuitOpenedAt < this.config.circuitResetMs) {
      throw new ProviderCircuitOpenError('AI provider circuit is temporarily open');
    }
    if (this.circuitOpenedAt > 0) {
      this.circuitOpenedAt = 0;
      this.consecutiveFailures = 0;
    }
    return this.client;
  }

  private recordFailure(error: unknown, model: string): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.config.circuitFailureThreshold) {
      this.circuitOpenedAt = Date.now();
    }
    this.logger.warn(
      { model, failures: this.consecutiveFailures, circuitOpen: this.circuitOpenedAt > 0, err: error },
      'AI provider request failed',
    );
  }

  private async invoke(
    systemPrompt: string,
    userPrompt: string,
    route: ModelRoute,
    model: string,
    allowCurrentRequestFallback = false,
  ): Promise<Omit<ProviderCompletion, 'fallbackUsed'>> {
    const client = allowCurrentRequestFallback && this.client
      ? this.client
      : this.assertAvailable();
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const started = Date.now();
      try {
        const response = await client.chat.completions.create(
          {
            model,
            messages: [
              { role: 'developer', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: route.temperature,
            max_completion_tokens: Math.min(route.maxTokens, this.config.maxOutputTokens),
            store: false,
          },
          { timeout: Math.min(route.timeoutMs, this.config.timeoutMs) },
        );
        const content = response.choices[0]?.message.content;
        if (!content) throw new Error('AI provider returned an empty response');
        this.consecutiveFailures = 0;
        return {
          content,
          provider: 'openai',
          model: response.model || model,
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        lastError = error;
        this.recordFailure(error, model);
        if (attempt < this.config.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(250 * 2 ** attempt, 2_000)));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('AI provider request failed');
  }

  async complete(
    systemPrompt: string,
    userPrompt: string,
    route: ModelRoute,
    _mode: AIMode | 'AI_MONITORING_CHAT',
  ): Promise<ProviderCompletion> {
    try {
      return { ...(await this.invoke(systemPrompt, userPrompt, route, route.primaryModel)), fallbackUsed: false };
    } catch (primaryError) {
      if (!route.fallbackModel || route.fallbackModel === route.primaryModel) throw primaryError;
      this.logger.warn({ primaryModel: route.primaryModel }, 'Falling back to secondary AI model');
      // The circuit opens for subsequent requests, but the in-flight request is
      // still allowed one configured fallback attempt for graceful degradation.
      return { ...(await this.invoke(systemPrompt, userPrompt, route, route.fallbackModel, true)), fallbackUsed: true };
    }
  }

  async embed(text: string): Promise<number[] | null> {
    if (!this.available || !text.trim()) return null;
    const client = this.assertAvailable();
    try {
      const response = await client.embeddings.create({
        model: this.config.embeddingModel,
        input: text.slice(0, 20_000),
        encoding_format: 'float',
      });
      this.consecutiveFailures = 0;
      return response.data[0]?.embedding ?? null;
    } catch (error) {
      this.recordFailure(error, this.config.embeddingModel);
      return null; // RAG degrades to tenant-scoped lexical retrieval.
    }
  }
}
