import { z } from "zod";
export declare const CreateSsoProviderSchema: z.ZodObject<{
    providerName: z.ZodString;
    providerType: z.ZodEnum<{
        saml: "saml";
        oidc: "oidc";
    }>;
    entityId: z.ZodOptional<z.ZodString>;
    ssoUrl: z.ZodOptional<z.ZodString>;
    x509Certificate: z.ZodOptional<z.ZodString>;
    domain: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const UpdateSsoProviderSchema: z.ZodObject<{
    providerName: z.ZodOptional<z.ZodString>;
    entityId: z.ZodOptional<z.ZodString>;
    ssoUrl: z.ZodOptional<z.ZodString>;
    x509Certificate: z.ZodOptional<z.ZodString>;
    domain: z.ZodOptional<z.ZodString>;
    isActive: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export interface OrgSsoProviderRow {
    id: string;
    org_id: string;
    provider_name: string;
    provider_type: string;
    entity_id: string | null;
    sso_url: string | null;
    domain: string | null;
    is_active: boolean;
    created_at: Date;
}
//# sourceMappingURL=sso.schema.d.ts.map