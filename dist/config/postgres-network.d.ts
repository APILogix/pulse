import type { ClientConfig, Pool } from 'pg';
export type PostgresAddressFamily = 4 | 6;
export interface PostgresNetworkConfig {
    family?: PostgresAddressFamily;
    stream?: NonNullable<ClientConfig['stream']>;
}
export type PostgresHealthFailure = 'dns' | 'tcp' | 'tls' | 'authentication' | 'timeout' | 'query';
export interface SafePostgresConnectionTarget {
    host: string;
    port: number;
    database: string;
}
export interface SafePostgresConnectionMetadata extends SafePostgresConnectionTarget {
    host: string;
    port: number;
    database: string;
    family: 0 | PostgresAddressFamily;
    ssl: boolean;
    poolMax: number;
    poolMin: number;
}
/**
 * Parses DB_FAMILY without silently accepting an unsupported value.
 * Unset, an empty string, and 0 preserve Node's default address selection.
 */
export declare function parsePostgresAddressFamily(value: unknown): PostgresAddressFamily | undefined;
/**
 * Adds an address-family override without changing any existing pool settings.
 * `family` remains present as diagnostic metadata; the stream enforces it.
 */
export declare function withPostgresAddressFamily<T extends ClientConfig>(config: T, family: PostgresAddressFamily | undefined): T & PostgresNetworkConfig;
/** Produces a database target that can never include user names or passwords. */
export declare function getSafePostgresConnectionTarget(connectionString: string): SafePostgresConnectionTarget;
/** Produces connection diagnostics that can never include user names or passwords. */
export declare function getSafePostgresConnectionMetadata(connectionString: string, options: {
    family?: PostgresAddressFamily | undefined;
    ssl: ClientConfig['ssl'];
    poolMax: number;
    poolMin: number;
}): SafePostgresConnectionMetadata;
export declare function classifyPostgresHealthError(error: unknown): PostgresHealthFailure;
/** Table-independent PostgreSQL readiness probe with a safe failure category. */
export declare function checkPostgresHealth(executor: Pick<Pool, 'query'>): Promise<{
    healthy: true;
} | {
    healthy: false;
    failure: PostgresHealthFailure;
}>;
//# sourceMappingURL=postgres-network.d.ts.map