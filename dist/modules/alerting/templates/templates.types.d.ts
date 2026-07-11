import { z } from 'zod';
import { type AlertSeverity } from '../common.js';
export declare const CreateTemplateSchema: z.ZodObject<{
    name: z.ZodString;
    templateType: z.ZodDefault<z.ZodString>;
    content: z.ZodString;
    variablesSchema: z.ZodDefault<z.ZodArray<z.ZodUnknown>>;
    defaultForSeverity: z.ZodOptional<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>;
    connectorType: z.ZodOptional<z.ZodString>;
    isDefault: z.ZodDefault<z.ZodBoolean>;
    sampleData: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type CreateTemplateBody = z.infer<typeof CreateTemplateSchema>;
export declare const UpdateTemplateSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    templateType: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    content: z.ZodOptional<z.ZodString>;
    variablesSchema: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodUnknown>>>;
    defaultForSeverity: z.ZodOptional<z.ZodOptional<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>>;
    connectorType: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    isDefault: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    sampleData: z.ZodOptional<z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, z.core.$strip>;
export type UpdateTemplateBody = z.infer<typeof UpdateTemplateSchema>;
export declare const PreviewTemplateSchema: z.ZodObject<{
    sampleData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type PreviewTemplateBody = z.infer<typeof PreviewTemplateSchema>;
export interface AlertTemplateRow {
    id: string;
    organization_id: string;
    name: string;
    template_type: string;
    content: string;
    variables_schema: unknown[];
    default_for_severity: AlertSeverity | null;
    connector_type: string | null;
    is_default: boolean;
    sample_data: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}
//# sourceMappingURL=templates.types.d.ts.map