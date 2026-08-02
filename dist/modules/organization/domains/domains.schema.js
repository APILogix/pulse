import { z } from 'zod';
const DomainNameSchema = z.string().trim().toLowerCase().max(253).regex(/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/);
export const DomainParamsSchema = z.object({ organizationId: z.string().uuid(), domainId: z.string().uuid() });
export const OrganizationDomainParamsSchema = z.object({ organizationId: z.string().uuid() });
export const CreateDomainSchema = z.object({ domain: DomainNameSchema, metadata: z.record(z.string(), z.unknown()).optional() });
export const UpdateDomainSchema = z.object({ metadata: z.record(z.string(), z.unknown()) });
export const ListDomainsSchema = z.object({ cursor: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(25), search: z.string().trim().max(253).optional(), verified: z.coerce.boolean().optional() });
//# sourceMappingURL=domains.schema.js.map