import { type OrgPolicy, type TrustedTopology } from "./compiler.js";
import { type EditableConfigView, type MutationMethod } from "./editable-view.js";
import { type ApiKeyMapping, type DeliveryRequestHints, type OperatorOverride } from "./delivery.js";
import type { SchemaV1Config } from "./schema-v1.js";
/** Full tenant scope for one environment's config head. */
export interface ConfigScope {
    organizationId: string;
    projectId: string;
    environmentId: string;
    environmentKey: string;
}
export type RevisionChangeType = "initial" | "publish" | "rollback";
/** One immutable revision row (requested intent + full compiled snapshot). */
export interface RevisionRecord {
    revisionNo: number;
    requestedConfig: Record<string, unknown>;
    compiledSnapshot: SchemaV1Config;
    canonicalSha256: string;
    changeType: RevisionChangeType;
    rolledBackToRevision: number | null;
}
export interface HeadRecord {
    currentRevisionNo: number;
    draftVersion: number;
}
export interface AppendRevisionInput {
    requestedConfig: Record<string, unknown>;
    compiledSnapshot: SchemaV1Config;
    canonicalSha256: string;
    changeType: RevisionChangeType;
    rolledBackToRevision: number | null;
    publishedBy: string;
}
/**
 * Persistence port. Implementations MUST keep revisions append-only and advance
 * the head pointer atomically under a per-head lock.
 */
export interface ConfigStore {
    loadCurrent(scope: ConfigScope): Promise<{
        head: HeadRecord;
        current: RevisionRecord;
    } | null>;
    loadRevision(scope: ConfigScope, revisionNo: number): Promise<RevisionRecord | null>;
    appendRevision(scope: ConfigScope, input: AppendRevisionInput): Promise<{
        head: HeadRecord;
        revision: RevisionRecord;
    }>;
    initialize(scope: ConfigScope, revision: RevisionRecord, createdBy: string | null): Promise<{
        head: HeadRecord;
        current: RevisionRecord;
    }>;
    loadCompiledByEnvironment(organizationId: string, environmentId: string): Promise<{
        revisionNo: number;
        compiledSnapshot: SchemaV1Config;
        environmentName: string;
    } | null>;
}
export interface ServiceOptions {
    topology: TrustedTopology | ((scope: ConfigScope) => TrustedTopology);
    orgPolicy?: (scope: ConfigScope) => OrgPolicy | undefined;
    /** Injected clock for deterministic meta.generatedAt. */
    clock?: () => string;
}
export interface PublishInput {
    method: MutationMethod;
    body: unknown;
    actorId: string;
}
export interface DeliveryResult {
    organizationId: string;
    projectId: string;
    environmentId: string;
    revisionNo: number;
    config: SchemaV1Config;
    etag: string;
    usedDefaultFallback: boolean;
}
export declare class RemoteSdkConfigService {
    private readonly store;
    private readonly options;
    constructor(store: ConfigStore, options: ServiceOptions);
    private topologyFor;
    private policyFor;
    private now;
    /** Compile a full snapshot for this scope from validated editable intent. */
    private compileFor;
    private viewFor;
    /**
     * Atomically initialize revision 1 for a newly created environment. Idempotent:
     * if a head already exists it returns the current editable view unchanged.
     */
    initialize(scope: ConfigScope, createdBy?: string | null): Promise<EditableConfigView>;
    /** Return the current EditableConfigView (never the compiled snapshot). */
    getEditableView(scope: ConfigScope): Promise<EditableConfigView>;
    /**
     * Publish a mutation. Rejects protected/unknown/invalid input (422) BEFORE any
     * persistence, then compiles, validates the full document, and appends a new
     * immutable revision.
     */
    publish(scope: ConfigScope, input: PublishInput): Promise<EditableConfigView>;
    /**
     * Roll back to a prior revision's intent by recompiling it under CURRENT policy
     * and APPENDING a new revision. The pointer never moves backward (Property 7).
     */
    rollback(scope: ConfigScope, targetRevisionNo: number, actorId: string): Promise<EditableConfigView>;
    /**
     * Build the SDK delivery document for an authenticated API-key mapping. Scope is
     * resolved from the mapping; request-body identity is ignored (Property 1).
     */
    buildDelivery(mapping: ApiKeyMapping, hints: DeliveryRequestHints, override?: OperatorOverride): Promise<DeliveryResult>;
}
//# sourceMappingURL=sdk-config.service.d.ts.map