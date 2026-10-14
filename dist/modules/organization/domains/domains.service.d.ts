import type { FastifyBaseLogger } from 'fastify';
import type { RequestMeta, OrgRole } from '../shared/types.js';
import { DomainsRepository } from './domains.repository.js';
/**
 * Service managing corporate domain verification, DNS TXT challenge validation,
 * and SSO auto-join policies for organizations.
 */
export declare class DomainsService {
    private readonly repo;
    private readonly requireMember;
    private readonly audit;
    private readonly log;
    private readonly resolveTxt;
    constructor(repo: DomainsRepository, requireMember: (orgId: string, userId: string, minRole?: OrgRole) => Promise<unknown>, audit: (meta: RequestMeta, data: any) => Promise<void>, log: FastifyBaseLogger, resolveTxt?: (domain: string) => Promise<string[][]>);
    /**
     * Lists verified and pending domains for an organization.
     */
    list(meta: RequestMeta, org: string, q: any): Promise<{
        data: {
            id: string;
            domain: string;
            isPrimary: boolean;
            isVerified: boolean;
            autoJoinEnabled: boolean;
            verificationMethod: string | null;
            verificationStartedAt: Date | null;
            verifiedAt: Date | null;
            lastVerificationCheckAt: Date | null;
            metadata: Record<string, unknown>;
            createdAt: Date;
            updatedAt: Date;
        }[];
        meta: {
            hasMore: boolean;
            nextCursor: string | null;
            limit: number;
            totalCount: number;
        };
    }>;
    /**
     * Retrieves details of a specific domain by ID.
     */
    get(meta: RequestMeta, org: string, id: string): Promise<{
        id: string;
        domain: string;
        isPrimary: boolean;
        isVerified: boolean;
        autoJoinEnabled: boolean;
        verificationMethod: string | null;
        verificationStartedAt: Date | null;
        verifiedAt: Date | null;
        lastVerificationCheckAt: Date | null;
        metadata: Record<string, unknown>;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Registers a new custom domain for verification and generates a DNS TXT challenge token.
     */
    create(meta: RequestMeta, org: string, domain: string, metadata?: Record<string, unknown>): Promise<{
        dnsInstructions: {
            recordType: string;
            host: string;
            value: string;
        };
        id: string;
        domain: string;
        isPrimary: boolean;
        isVerified: boolean;
        autoJoinEnabled: boolean;
        verificationMethod: string | null;
        verificationStartedAt: Date | null;
        verifiedAt: Date | null;
        lastVerificationCheckAt: Date | null;
        metadata: Record<string, unknown>;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Initiates DNS TXT record check for a domain. Requires organization owner.
     */
    verify(meta: RequestMeta, org: string, id: string): Promise<{
        verified: boolean;
        id: string;
        domain: string;
        isPrimary: boolean;
        isVerified: boolean;
        autoJoinEnabled: boolean;
        verificationMethod: string | null;
        verificationStartedAt: Date | null;
        verifiedAt: Date | null;
        lastVerificationCheckAt: Date | null;
        metadata: Record<string, unknown>;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Internal verification worker with leak-free DNS resolution.
     * Cleans up timers in a finally block to prevent event loop retention.
     */
    verifyInternal(org: string, id: string, meta?: RequestMeta): Promise<{
        verified: boolean;
        id: string;
        domain: string;
        isPrimary: boolean;
        isVerified: boolean;
        autoJoinEnabled: boolean;
        verificationMethod: string | null;
        verificationStartedAt: Date | null;
        verifiedAt: Date | null;
        lastVerificationCheckAt: Date | null;
        metadata: Record<string, unknown>;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Toggles automatic joining of new users with matching verified domain emails.
     */
    autoJoin(meta: RequestMeta, org: string, id: string, enabled: boolean): Promise<{
        id: string;
        domain: string;
        isPrimary: boolean;
        isVerified: boolean;
        autoJoinEnabled: boolean;
        verificationMethod: string | null;
        verificationStartedAt: Date | null;
        verifiedAt: Date | null;
        lastVerificationCheckAt: Date | null;
        metadata: Record<string, unknown>;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Updates metadata associated with a domain.
     */
    update(meta: RequestMeta, org: string, id: string, metadata: Record<string, unknown>): Promise<{
        id: string;
        domain: string;
        isPrimary: boolean;
        isVerified: boolean;
        autoJoinEnabled: boolean;
        verificationMethod: string | null;
        verificationStartedAt: Date | null;
        verifiedAt: Date | null;
        lastVerificationCheckAt: Date | null;
        metadata: Record<string, unknown>;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Soft-deletes a domain, ensuring no active SSO or SCIM configurations depend on it.
     */
    delete(meta: RequestMeta, org: string, id: string): Promise<void>;
    /**
     * Designates a verified domain as the primary domain for the organization.
     */
    primary(meta: RequestMeta, org: string, id: string): Promise<{
        id: string;
        domain: string;
        isPrimary: boolean;
        isVerified: boolean;
        autoJoinEnabled: boolean;
        verificationMethod: string | null;
        verificationStartedAt: Date | null;
        verifiedAt: Date | null;
        lastVerificationCheckAt: Date | null;
        metadata: Record<string, unknown>;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Batch verifies all pending domains across organizations up to a specified limit.
     */
    verifyPending(limit?: number): Promise<{
        checked: number;
        verified: number;
    }>;
}
//# sourceMappingURL=domains.service.d.ts.map