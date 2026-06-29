/**
 * Connector registry + factory (Plugin + Factory patterns).
 *
 * - Plugin architecture: connector types register a constructor at module load
 *   via `registerConnectorType`. New providers are added by registering here;
 *   nothing else in the system needs to change.
 * - Factory: `createConnector` instantiates the right Strategy implementation
 *   for a stored config row, injecting a {@link ConnectorContext}.
 *
 * The registry is a process-wide singleton; registration is idempotent.
 */
import type { FastifyBaseLogger } from 'fastify';
import { BaseConnector } from './connectors/base.connector.js';
import { type ConnectorContext, type ConnectorType, type ConnectorTypeInfoDto } from './types.js';
type ConnectorConstructor = new (ctx: ConnectorContext) => BaseConnector;
interface RegistryEntry {
    ctor: ConnectorConstructor;
    info: Omit<ConnectorTypeInfoDto, 'capabilities'> & {
        capabilities: ConnectorTypeInfoDto['capabilities'];
    };
}
/** Register (or override) a connector type. Idempotent by type key. */
export declare function registerConnectorType(type: ConnectorType, entry: RegistryEntry): void;
/** Whether a connector type is registered. */
export declare function isConnectorTypeRegistered(type: string): type is ConnectorType;
/** Factory: build a connector instance for a given context. */
export declare function createConnector(type: ConnectorType, ctx: ConnectorContext): BaseConnector;
/** Metadata for every registered connector type (powers GET /connectors/types). */
export declare function listConnectorTypes(): ConnectorTypeInfoDto[];
/** Capability flags for a type without instantiating it. */
export declare function getTypeCapabilities(type: ConnectorType): ConnectorTypeInfoDto['capabilities'];
/**
 * Build a lightweight context for capability/validation checks that don't need
 * a real org/config (e.g. validating a create request before persistence).
 */
export declare function ephemeralContext(type: ConnectorType, config: Record<string, unknown>, log: FastifyBaseLogger): ConnectorContext;
export {};
//# sourceMappingURL=registry.d.ts.map