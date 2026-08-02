import { z } from "zod";
export const CreateSsoProviderSchema = z.object({
    providerName: z.string().min(1).max(100),
    providerType: z.enum(["saml", "oidc"]),
    entityId: z.string().optional(),
    ssoUrl: z.string().url().optional(),
    x509Certificate: z.string().optional(),
    domain: z.string().max(255).optional(),
});
export const UpdateSsoProviderSchema = z.object({
    providerName: z.string().min(1).max(100).optional(),
    entityId: z.string().optional(),
    ssoUrl: z.string().url().optional(),
    x509Certificate: z.string().optional(),
    domain: z.string().max(255).optional(),
    isActive: z.boolean().optional(),
});
//# sourceMappingURL=sso.schema.js.map