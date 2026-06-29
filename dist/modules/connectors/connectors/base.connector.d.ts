/**
 * Abstract base connector (Strategy pattern).
 *
 * Concrete connectors extend this and implement:
 *   - `configSchema` (Zod) for `validateConfig`
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
import type { ConnectionTestResult, ConnectorConfig, ConnectorContext, ConnectorType, DeliveryResult, HealthStatus, INotificationConnector, NotificationPayload, RateLimitInfo, ValidationResult } from '../types.js';
export declare abstract class BaseConnector implements INotificationConnector {
    readonly id: string;
    readonly name: string;
    abstract readonly type: ConnectorType;
    protected readonly ctx: ConnectorContext;
    constructor(ctx: ConnectorContext);
    /** Zod schema describing this connector's config shape. */
    protected abstract get configSchema(): ZodType;
    /** Provider-specific delivery. Throw ConnectorDeliveryError on failure. */
    protected abstract deliver(notification: NotificationPayload): Promise<DeliveryResult>;
    abstract testConnection(): Promise<ConnectionTestResult>;
    abstract supportsRichFormatting(): boolean;
    abstract supportsThreading(): boolean;
    abstract supportsAttachments(): boolean;
    validateConfig(config: ConnectorConfig): ValidationResult;
    send(notification: NotificationPayload): Promise<DeliveryResult>;
    getHealthStatus(): Promise<HealthStatus>;
    getRateLimitInfo(): RateLimitInfo;
    /** Typed view of the injected config, validated lazily by callers. */
    protected config<T>(): T;
}
//# sourceMappingURL=base.connector.d.ts.map