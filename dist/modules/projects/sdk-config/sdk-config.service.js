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
import { compile, compileInitial } from "./compiler.js";
import { applyEditableMutation, projectEditableView } from "./editable-view.js";
import { assertSupportedSchemaVersion, buildDeliverySnapshot, resolveDeliveryScope, } from "./delivery.js";
import { SdkConfigError } from "./errors.js";
export class RemoteSdkConfigService {
    store;
    options;
    lastGeneratedAtMs = null;
    constructor(store, options) {
        this.store = store;
        this.options = options;
    }
    topologyFor(scope) {
        return typeof this.options.topology === "function" ? this.options.topology(scope) : this.options.topology;
    }
    policyFor(scope) {
        return this.options.orgPolicy ? this.options.orgPolicy(scope) : undefined;
    }
    now() {
        const supplied = this.options.clock ? this.options.clock() : new Date().toISOString();
        const parsed = Date.parse(supplied);
        if (!Number.isFinite(parsed)) {
            throw new SdkConfigError("schema_invalid", "SDK config clock returned an invalid timestamp", 500, [
                { path: "/meta/generatedAt", rule: "date-time", message: "Clock must return an ISO-8601 timestamp" },
            ]);
        }
        const generatedAtMs = this.lastGeneratedAtMs === null
            ? parsed
            : Math.max(parsed, this.lastGeneratedAtMs + 1);
        this.lastGeneratedAtMs = generatedAtMs;
        return new Date(generatedAtMs).toISOString();
    }
    /** Compile a full snapshot for this scope from validated editable intent. */
    compileFor(scope, requestedIntent) {
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
    viewFor(scope, head, revision) {
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
    async initialize(scope, createdBy = null) {
        const existing = await this.store.loadCurrent(scope);
        if (existing)
            return this.viewFor(scope, existing.head, existing.current);
        const policy = this.policyFor(scope);
        const compiled = compileInitial({ projectId: scope.projectId, environment: scope.environmentKey }, this.topologyFor(scope), this.now(), policy);
        validateSchemaV1(compiled);
        const revision = {
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
    async getEditableView(scope) {
        const loaded = await this.store.loadCurrent(scope);
        if (!loaded)
            throw new SdkConfigError("not_found", "Environment configuration not found", 404);
        return this.viewFor(scope, loaded.head, loaded.current);
    }
    /**
     * Publish a mutation. Rejects protected/unknown/invalid input (422) BEFORE any
     * persistence, then compiles, validates the full document, and appends a new
     * immutable revision.
     */
    async publish(scope, input) {
        const loaded = await this.store.loadCurrent(scope);
        if (!loaded)
            throw new SdkConfigError("not_found", "Environment configuration not found", 404);
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
    async rollback(scope, targetRevisionNo, actorId) {
        const target = await this.store.loadRevision(scope, targetRevisionNo);
        if (!target)
            throw new SdkConfigError("not_found", `Revision ${targetRevisionNo} not found`, 404);
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
    async buildDelivery(mapping, hints, override) {
        assertSupportedSchemaVersion(hints.schemaVersion);
        const scope = resolveDeliveryScope(mapping, hints);
        let environmentId = null;
        let loaded = null;
        if (scope.source === "sdk_metadata" && scope.environment) {
            const sdkLoaded = await this.store.loadCompiledBySdkMetadata(scope.organizationId, scope.projectId, scope.environment);
            if (sdkLoaded) {
                environmentId = sdkLoaded.environmentId;
                loaded = sdkLoaded;
            }
        }
        else if (scope.environmentId) {
            environmentId = scope.environmentId;
            loaded = await this.store.loadCompiledByEnvironment(scope.organizationId, scope.environmentId);
        }
        if (!loaded) {
            // No safe committed representation -> 503 so the SDK keeps LKG/defaults.
            throw new SdkConfigError("not_found", "No committed configuration available", 503);
        }
        if (!environmentId) {
            throw new SdkConfigError("not_found", "No committed configuration available", 503);
        }
        const snapshot = buildDeliverySnapshot({
            compiled: loaded.compiledSnapshot,
            ...(override !== undefined ? { override } : {}),
        });
        return {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            environmentId,
            revisionNo: loaded.revisionNo,
            config: snapshot.config,
            etag: snapshot.etag,
            usedDefaultFallback: scope.usedDefaultFallback,
        };
    }
}
//# sourceMappingURL=sdk-config.service.js.map