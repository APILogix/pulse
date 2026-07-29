import { type SdkConfigErrorDetail } from "./errors.js";
import type { SchemaV1Config } from "./schema-v1.js";
export type EditableValueSource = "schema-default" | "platform-safety" | "organization-policy" | "project-environment" | "emergency-override";
export interface SafeEffectiveValue {
    value: unknown;
    source: EditableValueSource;
    constrained: boolean;
}
export type WorkflowState = "current" | "draft" | "awaiting_approval";
export interface EditableConfigView {
    type: "editableConfigView";
    scope: {
        organizationId: string;
        projectId: string;
        environmentId: string;
        environmentKey: string;
    };
    revision: {
        currentRevisionNo: number;
        draftVersion: number;
        workflowState: WorkflowState;
    };
    editableConfig: Record<string, unknown>;
    effectiveSummary: Record<string, SafeEffectiveValue>;
    validation: {
        status: "not_validated" | "valid" | "invalid";
        errors: SdkConfigErrorDetail[];
        warnings: SdkConfigErrorDetail[];
    };
}
/**
 * Extract the editable subset of a compiled snapshot: every leaf that classifies
 * as `editable`, rebuilt field-by-field into a fresh object. Protected leaves
 * (sdk.*, meta.*, entitlements.*, transport.routes.*.url, keepAlive, priority,
 * compression, schemaVersion) are excluded by construction.
 */
export declare function extractEditableConfig(compiled: SchemaV1Config): Record<string, unknown>;
export interface ProjectViewInput {
    scope: EditableConfigView["scope"];
    compiled: SchemaV1Config;
    requestedIntent: Record<string, unknown>;
    currentRevisionNo: number;
    draftVersion?: number;
    workflowState?: WorkflowState;
    validation?: EditableConfigView["validation"];
}
/** Project a safe EditableConfigView. Never includes protected/compiled fields. */
export declare function projectEditableView(input: ProjectViewInput): EditableConfigView;
export type MutationMethod = "PUT" | "PATCH";
export interface MutationInput {
    currentIntent: Record<string, unknown>;
    body: unknown;
    method: MutationMethod;
}
/**
 * Validate and apply a PUT/PATCH mutation to editable intent. Returns the new
 * normalized intent. Throws a 422 SdkConfigError listing every protected,
 * unknown, or invalid pointer WITHOUT mutating state when any exist.
 */
export declare function applyEditableMutation(input: MutationInput): Record<string, unknown>;
//# sourceMappingURL=editable-view.d.ts.map