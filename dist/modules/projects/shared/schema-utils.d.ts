import { z } from "zod";
export declare const normalizeObjectKeys: (value: unknown) => unknown;
export declare const OptionalDateSchema: z.ZodPipe<z.ZodTransform<{} | null | undefined, unknown>, z.ZodOptional<z.ZodNullable<z.ZodDate>>>;
export declare const Ipv4OrV6: z.ZodString;
export declare const CountryCode: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
export declare const OrgRoleSchema: z.ZodEnum<{
    security: "security";
    admin: "admin";
    member: "member";
    owner: "owner";
    developer: "developer";
    billing: "billing";
    viewer: "viewer";
}>;
export type OrgRole = z.infer<typeof OrgRoleSchema>;
export declare const OrgIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
}, z.core.$strip>;
export interface OrganizationMembership {
    orgId: string;
    userId: string;
    role: OrgRole;
    isActive: boolean;
}
//# sourceMappingURL=schema-utils.d.ts.map