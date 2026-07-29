/**
 * RemoteSdkConfigService — orchestrates the pure core against a persistence port.
 *
 * The service depends only on a `ConfigStore` port (implemented by the pg adapter
 * in production and by an in-memory fake in tests) plus the deterministic core.
 * It enforces every strict requirement at the seams:
 *   - initialize(): atomic revision-1 compile for a new environment (idempotent).
 *   - getEditableView(): returns ONLY EditableConfigView.
 *   - publish(): validate+allowlist intent -> compile -> validate doc -> append.
 *   - rollback(): recompile a prior intent and APPEND a new revision (never rewind).
 *   - buildDelivery(): resolve scope from the key mapping, project the snapshot.
 */
import { validateSchemaV1 } from "./validator.js";
import { compile, compileInitial, type OrgPolicy, type TrustedTopology } from "./compiler.js";
import { applyEditableMutation, projectEditableView, type EditableConfigView, type MutationMethod } from "./editable-view.js";
import {
  assertSupportedSchemaVersion,
  buildDeliverySnapshot,
  resolveDeliveryScope,
  type ApiKeyMapping,
  type DeliveryRequestHints,
  type OperatorOverride,
} from "./delivery.js";
import { SdkConfigError } from "./errors.js";
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
  loadCurrent(scope: ConfigScope): Promise<{ head: HeadRecord; current: RevisionRecord } | null>;
  loadRevision(scope: ConfigScope, revisionNo: number): Promise<RevisionRecord | null>;
  appendRevision(scope: ConfigScope, input: AppendRevisionInput): Promise<{ head: HeadRecord; revision: RevisionRecord }>;
  initialize(scope: ConfigScope, revision: RevisionRecord, createdBy: string | null): Promise<{ head: HeadRecord; current: RevisionRecord }>;
  loadCompiledByEnvironment(
    organizationId: string,
    environmentId: string,
  ): Promise<{ revisionNo: number; compiledSnapshot: SchemaV1Config; environmentName: string } | null>;
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

export class RemoteSdkConfigService {
  constructor(
    private readonly store: ConfigStore,
    private readonly options: ServiceOptions,
  ) {}

  private topologyFor(scope: ConfigScope): TrustedTopology {
    return typeof this.options.topology === "function" ? this.options.topology(scope) : this.options.topology;
  }

  private policyFor(scope: ConfigScope): OrgPolicy | undefined {
    return this.options.orgPolicy ? this.options.orgPolicy(scope) : undefined;
  }

  private now(): string {
    return this.options.clock ? this.options.clock() : new Date().toISOString();
  }

  /** Compile a full snapshot for this scope from validated editable intent. */
  private compileFor(scope: ConfigScope, requestedIntent: Record<string, unknown>): SchemaV1Config {
    const policy = this.policyFor(scope);
    const config = compile({
      identity: { projectId: scope.projectId, environment: scope.environmentKey },
      topology: this.topologyFor(scope),
      requestedIntent,
      generatedAt: this.now(),
      ...(policy !== undefined ? { orgPolicy: policy } : {}),
    });
    validateSchemaV1(config);
    return config;
  }

  private viewFor(scope: ConfigScope, head: HeadRecord, revision: RevisionRecord): EditableConfigView {
    return projectEditableView({
      scope,
      compiled: revision.compiledSnapshot,
      requestedIntent: revision.requestedConfig,
      currentRevisionNo: head.currentRevisionNo,
      draftVersion: head.draftVersion,
    });
  }

  /**
   * Atomically initialize revision 1 for a newly created environment. Idempotent:
   * if a head already exists it returns the current editable view unchanged.
   */
  async initialize(scope: ConfigScope, createdBy: string | null = null): Promise<EditableConfigView> {
    const existing = await this.store.loadCurrent(scope);
    if (existing) return this.viewFor(scope, existing.head, existing.current);

    const policy = this.policyFor(scope);
    const compiled = compileInitial(
      { projectId: scope.projectId, environment: scope.environmentKey },
      this.topologyFor(scope),
      this.now(),
      policy,
    );
    validateSchemaV1(compiled);
    const revision: RevisionRecord = {
      revisionNo: 1,
      requestedConfig: {},
      compiledSnapshot: compiled,
      canonicalSha256: compiled.meta.configHash ?? "",
      changeType: "initial",
      rolledBackToRevision: null,
    };
    const { head, current } = await this.store.initialize(scope, revision, createdBy);
    return this.viewFor(scope, head, current);
  }

  /** Return the current EditableConfigView (never the compiled snapshot). */
  async getEditableView(scope: ConfigScope): Promise<EditableConfigView> {
    const loaded = await this.store.loadCurrent(scope);
    if (!loaded) throw new SdkConfigError("not_found", "Environment configuration not found", 404);
    return this.viewFor(scope, loaded.head, loaded.current);
  }

  /**
   * Publish a mutation. Rejects protected/unknown/invalid input (422) BEFORE any
   * persistence, then compiles, validates the full document, and appends a new
   * immutable revision.
   */
  async publish(scope: ConfigScope, input: PublishInput): Promise<EditableConfigView> {
    const loaded = await this.store.loadCurrent(scope);
    if (!loaded) throw new SdkConfigError("not_found", "Environment configuration not found", 404);

    const newIntent = applyEditableMutation({
      currentIntent: loaded.current.requestedConfig,
      method: input.method,
      body: input.body,
    });
    const compiled = this.compileFor(scope, newIntent);
    const { head, revision } = await this.store.appendRevision(scope, {
      requestedConfig: newIntent,
      compiledSnapshot: compiled,
      canonicalSha256: compiled.meta.configHash ?? "",
      changeType: "publish",
      rolledBackToRevision: null,
      publishedBy: input.actorId,
    });
    return this.viewFor(scope, head, revision);
  }

  /**
   * Roll back to a prior revision's intent by recompiling it under CURRENT policy
   * and APPENDING a new revision. The pointer never moves backward (Property 7).
   */
  async rollback(
    scope: ConfigScope,
    targetRevisionNo: number,
    actorId: string,
  ): Promise<EditableConfigView> {
    const target = await this.store.loadRevision(scope, targetRevisionNo);
    if (!target) throw new SdkConfigError("not_found", `Revision ${targetRevisionNo} not found`, 404);

    const compiled = this.compileFor(scope, target.requestedConfig);
    const { head, revision } = await this.store.appendRevision(scope, {
      requestedConfig: target.requestedConfig,
      compiledSnapshot: compiled,
      canonicalSha256: compiled.meta.configHash ?? "",
      changeType: "rollback",
      rolledBackToRevision: targetRevisionNo,
      publishedBy: actorId,
    });
    return this.viewFor(scope, head, revision);
  }

  /**
   * Build the SDK delivery document for an authenticated API-key mapping. Scope is
   * resolved from the mapping; request-body identity is ignored (Property 1).
   */
  async buildDelivery(
    mapping: ApiKeyMapping,
    hints: DeliveryRequestHints,
    override?: OperatorOverride,
  ): Promise<DeliveryResult> {
    assertSupportedSchemaVersion(hints.schemaVersion);
    const scope = resolveDeliveryScope(mapping, hints);
    const loaded = await this.store.loadCompiledByEnvironment(scope.organizationId, scope.environmentId);
    if (!loaded) {
      // No safe committed representation -> 503 so the SDK keeps LKG/defaults.
      throw new SdkConfigError("not_found", "No committed configuration available", 503);
    }
    const compiledForDelivery: SchemaV1Config = {
      ...loaded.compiledSnapshot,
      sdk: {
        ...loaded.compiledSnapshot.sdk,
        environment: loaded.environmentName,
      },
      meta: {
        ...loaded.compiledSnapshot.meta,
        environmentName: loaded.environmentName,
      },
    };
    const snapshot = buildDeliverySnapshot({
      compiled: compiledForDelivery,
      ...(hints.capabilities !== undefined ? { capabilities: hints.capabilities } : {}),
      ...(override !== undefined ? { override } : {}),
    });
    return {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      environmentId: scope.environmentId,
      revisionNo: loaded.revisionNo,
      config: snapshot.config,
      etag: snapshot.etag,
      usedDefaultFallback: scope.usedDefaultFallback,
    };
  }
}
