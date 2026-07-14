import { z } from 'zod';

const DomainNameSchema = z.string().trim().toLowerCase().max(253).regex(/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/);
export const DomainParamsSchema = z.object({ organizationId: z.string().uuid(), domainId: z.string().uuid() });
export const OrganizationDomainParamsSchema = z.object({ organizationId: z.string().uuid() });
export const CreateDomainSchema = z.object({ domain: DomainNameSchema, metadata: z.record(z.string(), z.unknown()).optional() });
export const UpdateDomainSchema = z.object({ metadata: z.record(z.string(), z.unknown()) });
export const ListDomainsSchema = z.object({ cursor: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(25), search: z.string().trim().max(253).optional(), verified: z.coerce.boolean().optional() });

export interface VerifiedDomainRow { id: string; organization_id: string; domain: string; is_primary: boolean; is_verified: boolean; auto_join_enabled: boolean; verification_method: string | null; verification_token: string | null; verification_started_at: Date | null; verified_at: Date | null; verified_by: string | null; last_verification_check_at: Date | null; metadata: Record<string, unknown>; created_at: Date; updated_at: Date; deleted_at: Date | null; }
