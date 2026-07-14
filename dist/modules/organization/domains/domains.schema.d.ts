import { z } from 'zod';
export declare const DomainParamsSchema: z.ZodObject<{
    organizationId: z.ZodString;
    domainId: z.ZodString;
}, z.core.$strip>;
export declare const OrganizationDomainParamsSchema: z.ZodObject<{
    organizationId: z.ZodString;
}, z.core.$strip>;
export declare const CreateDomainSchema: z.ZodObject<{
    domain: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const UpdateDomainSchema: z.ZodObject<{
    metadata: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strip>;
export declare const ListDomainsSchema: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    search: z.ZodOptional<z.ZodString>;
    verified: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
}, z.core.$strip>;
export interface VerifiedDomainRow {
    id: string;
    organization_id: string;
    domain: string;
    is_primary: boolean;
    is_verified: boolean;
    auto_join_enabled: boolean;
    verification_method: string | null;
    verification_token: string | null;
    verification_started_at: Date | null;
    verified_at: Date | null;
    verified_by: string | null;
    last_verification_check_at: Date | null;
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}
//# sourceMappingURL=domains.schema.d.ts.map