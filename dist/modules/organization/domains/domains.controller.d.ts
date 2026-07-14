import type { FastifyRequest } from 'fastify';
import type { DomainsService } from './domains.service.js';
export declare class DomainsController {
    private readonly service;
    constructor(service: DomainsService);
    list: (r: FastifyRequest) => Promise<{
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
    get: (r: FastifyRequest) => Promise<{
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
    create: (r: FastifyRequest) => Promise<{
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
    verify: (r: FastifyRequest) => Promise<{
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
    autoJoin: (enabled: boolean) => (r: FastifyRequest) => Promise<{
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
    update: (r: FastifyRequest) => Promise<{
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
    remove: (r: FastifyRequest) => Promise<void>;
    primary: (r: FastifyRequest) => Promise<{
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
}
//# sourceMappingURL=domains.controller.d.ts.map