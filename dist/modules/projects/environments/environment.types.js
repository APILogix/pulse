import { z } from "zod";
import { normalizeObjectKeys } from "../shared/schema-utils.js";
export var EnvironmentType;
(function (EnvironmentType) {
    EnvironmentType["PRODUCTION"] = "production";
    EnvironmentType["PRE_PRODUCTION"] = "pre_production";
    EnvironmentType["STAGING"] = "staging";
    EnvironmentType["PRE_STAGING"] = "pre_staging";
    EnvironmentType["DEVELOPMENT"] = "development";
    EnvironmentType["TESTING"] = "testing";
    EnvironmentType["PREVIEW"] = "preview";
    EnvironmentType["PRE_DEPLOYMENT"] = "pre_deployment";
    EnvironmentType["CUSTOM"] = "custom";
})(EnvironmentType || (EnvironmentType = {}));
export const EnvironmentTypeSchema = z.enum([
    EnvironmentType.PRODUCTION,
    EnvironmentType.PRE_PRODUCTION,
    EnvironmentType.STAGING,
    EnvironmentType.PRE_STAGING,
    EnvironmentType.DEVELOPMENT,
    EnvironmentType.TESTING,
    EnvironmentType.PREVIEW,
    EnvironmentType.PRE_DEPLOYMENT,
    EnvironmentType.CUSTOM,
]);
export const EnvironmentNameSchema = z.string().trim().min(1).max(100);
export const EnvironmentSlugSchema = z.string().trim().min(1).max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens only");
export const EnvironmentColorSchema = z.string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Use a six-digit HEX color such as #2563EB");
export const EnvironmentParamsSchema = z.object({
    orgId: z.string().uuid(),
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
});
const environmentShape = {
    name: EnvironmentNameSchema,
    slug: EnvironmentSlugSchema,
    type: EnvironmentTypeSchema,
    description: z.string().trim().max(2000).nullable().optional(),
    color: EnvironmentColorSchema,
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
};
export const CreateEnvironmentBodySchema = z.preprocess(normalizeObjectKeys, z.object(environmentShape).strict().refine((value) => !value.isDefault || value.isActive !== false, { message: "The default environment must be active", path: ["isActive"] }));
export const UpdateEnvironmentBodySchema = z.preprocess(normalizeObjectKeys, z.object(environmentShape).partial().strict()
    .refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" })
    .refine((value) => !value.isDefault || value.isActive !== false, { message: "The default environment must be active", path: ["isActive"] }));
export const ListEnvironmentsQuerySchema = z.object({
    includeDeleted: z.preprocess((value) => value === true || value === "true", z.boolean()).default(false),
});
//# sourceMappingURL=environment.types.js.map