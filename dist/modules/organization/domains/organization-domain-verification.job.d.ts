import type { FastifyBaseLogger } from 'fastify';
export declare const ORGANIZATION_DOMAIN_VERIFICATION_JOB = "org_domain_verification";
export declare function registerOrganizationDomainVerificationJob(log: FastifyBaseLogger): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=organization-domain-verification.job.d.ts.map