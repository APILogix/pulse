import { z } from 'zod';
export declare const RoutingConditionsSchema: z.ZodObject<{
    severity: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>>;
    source: z.ZodOptional<z.ZodArray<z.ZodString>>;
    labels: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export type RoutingConditions = z.infer<typeof RoutingConditionsSchema>;
export declare const CreateRoutingRuleSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    priority: z.ZodDefault<z.ZodNumber>;
    conditions: z.ZodDefault<z.ZodObject<{
        severity: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            error: "error";
            info: "info";
            warning: "warning";
            critical: "critical";
        }>>>;
        source: z.ZodOptional<z.ZodArray<z.ZodString>>;
        labels: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>>;
    targetConnectorIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    targetRouteIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    fallbackConnectorIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    templateId: z.ZodOptional<z.ZodString>;
    isActive: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type CreateRoutingRuleBody = z.infer<typeof CreateRoutingRuleSchema>;
export declare const UpdateRoutingRuleSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    priority: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    conditions: z.ZodOptional<z.ZodDefault<z.ZodObject<{
        severity: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            error: "error";
            info: "info";
            warning: "warning";
            critical: "critical";
        }>>>;
        source: z.ZodOptional<z.ZodArray<z.ZodString>>;
        labels: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>>>;
    targetConnectorIds: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
    targetRouteIds: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
    fallbackConnectorIds: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
    templateId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    isActive: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
}, z.core.$strip>;
export type UpdateRoutingRuleBody = z.infer<typeof UpdateRoutingRuleSchema>;
export declare const TestRoutingSchema: z.ZodObject<{
    severity: z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>;
    source: z.ZodString;
    labels: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export type TestRoutingBody = z.infer<typeof TestRoutingSchema>;
export interface AlertRoutingRuleRow {
    id: string;
    organization_id: string;
    name: string;
    description: string | null;
    priority: number;
    conditions: RoutingConditions;
    target_connector_ids: string[];
    target_route_ids: string[];
    fallback_connector_ids: string[];
    template_id: string | null;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}
//# sourceMappingURL=routing.types.d.ts.map