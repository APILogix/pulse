/**
 * Abstract base connector (Strategy pattern).
 *
 * Concrete connectors extend this and implement:
 *   - `configSchema` (Zod) for `validateConfig` / `validateConfiguration`
 *   - `deliver()` for the actual provider call
 *   - capability flags + rate-limit info
 *
 * The base class provides:
 *   - Uniform `validateConfig` via the connector's Zod schema
 *   - `send()` wrapper that times delivery and normalizes thrown errors into
 *     a {@link DeliveryResult}
 *   - A sane default `getHealthStatus()` derived from `testConnection()`
 */
import type { ZodType } from 'zod';
import type {
  ConnectionTestResult,
  ConnectorConfig,
  ConnectorContext,
  ConnectorType,
  DeliveryResult,
  HealthStatus,
  INotificationConnector,
  NotificationPayload,
  RateLimitInfo,
  ValidationResult,
} from '../types.js';
import { ConnectorDeliveryError } from '../types.js';

export abstract class BaseConnector implements INotificationConnector {
  public readonly id: string;
  public readonly name: string;
  public abstract readonly type: ConnectorType;

  protected readonly ctx: ConnectorContext;

  constructor(ctx: ConnectorContext) {
    this.ctx = ctx;
    this.id = ctx.id;
    this.name = ctx.name;
  }

  /** Zod schema describing this connector's config shape. */
  protected abstract get configSchema(): ZodType;

  /** Provider-specific delivery. Throw ConnectorDeliveryError on failure. */
  protected abstract deliver(notification: NotificationPayload): Promise<DeliveryResult>;

  abstract testConnection(): Promise<ConnectionTestResult>;

  abstract supportsRichFormatting(): boolean;
  abstract supportsThreading(): boolean;
  abstract supportsAttachments(): boolean;

  validateConfig(config: ConnectorConfig): ValidationResult {
    const parsed = this.configSchema.safeParse(config);
    if (parsed.success) {
      return { valid: true, errors: [], normalized: parsed.data as ConnectorConfig };
    }
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }

  validateConfiguration(config: ConnectorConfig): ValidationResult {
    return this.validateConfig(config);
  }

  async send(notification: NotificationPayload): Promise<DeliveryResult> {
    const start = Date.now();
    try {
      const result = await this.deliver(notification);
      return { ...result, latencyMs: result.latencyMs || Date.now() - start };
    } catch (err) {
      if (err instanceof ConnectorDeliveryError) {
        return {
          success: false,
          errorMessage: err.message,
          failureCategory: err.failureCategory,
          retryable: err.retryable,
          latencyMs: Date.now() - start,
        };
      }
      // Unknown errors are treated as non-retryable to avoid hammering a
      // provider with a request that deterministically blows up.
      return {
        success: false,
        errorMessage: err instanceof Error ? err.message : 'Unknown delivery error',
        failureCategory: 'unknown',
        retryable: false,
        latencyMs: Date.now() - start,
      };
    }
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const test = await this.testConnection();
    return {
      state: test.success ? 'healthy' : 'unhealthy',
      responseTimeMs: test.latencyMs,
      message: test.message,
      checkedAt: new Date().toISOString(),
      ...(test.details ? { details: test.details } : {}),
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    return this.getHealthStatus();
  }

  async rotateSecret(config: ConnectorConfig): Promise<ValidationResult> {
    return this.validateConfiguration(config);
  }

  async refreshCredentials(credentials?: ConnectorConfig): Promise<ValidationResult> {
    return { valid: true, errors: [], normalized: credentials ?? this.serialize() };
  }

  serialize(): ConnectorConfig {
    return { ...this.ctx.config };
  }

  deserialize(config: ConnectorConfig): ValidationResult {
    return this.validateConfiguration(config);
  }

  getRateLimitInfo(): RateLimitInfo {
    return this.ctx.rateLimit;
  }

  /** Typed view of the injected config, validated lazily by callers. */
  protected config<T>(): T {
    return this.ctx.config as T;
  }
}
