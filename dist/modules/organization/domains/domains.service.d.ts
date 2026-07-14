import type { FastifyBaseLogger } from 'fastify';
import type { RequestMeta, OrgRole } from '../shared/types.js';
import { DomainsRepository } from './domains.repository.js';
export declare class DomainsService {
    private readonly repo;
    private readonly requireMember;
    private readonly audit;
    private readonly log;
    private readonly resolveTxt;
    constructor(repo: DomainsRepository, requireMember: (o: string, u: string, r?: OrgRole) => Promise<unknown>, audit: (m: RequestMeta, d: any) => Promise<void>, log: FastifyBaseLogger, resolveTxt?: (d: string) => Promise<string[][]>);
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
        };
    }>;
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
    delete(meta: RequestMeta, org: string, id: string): Promise<void>;
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
    verifyPending(limit?: number): Promise<{
        checked: number;
        verified: number;
    }>;
}
//# sourceMappingURL=domains.service.d.ts.map