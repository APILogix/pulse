import { pgboss } from '../../../lib/pgboss.js';
import { DomainsRepository } from './domains.repository.js';
import { DomainsService } from './domains.service.js';
export const ORGANIZATION_DOMAIN_VERIFICATION_JOB = 'organization.domain-verification';
export async function registerOrganizationDomainVerificationJob(log) { const service = new DomainsService(new DomainsRepository(), async () => undefined, async () => undefined, log); await pgboss.work(ORGANIZATION_DOMAIN_VERIFICATION_JOB, {}, (async () => { const result = await service.verifyPending(200); log.info(result, 'Organization domain verification batch complete'); })); await pgboss.schedule(ORGANIZATION_DOMAIN_VERIFICATION_JOB, '*/30 * * * *', {}, {}); }
//# sourceMappingURL=organization-domain-verification.job.js.map