import type { PoolClient } from 'pg';
import { BaseRepository } from '../shared/base.repository.js';
import type { CursorPaginationQuery, CursorPaginatedResponse } from '../shared/types.js';
import type { VerifiedDomainRow } from './domains.schema.js';
export declare class DomainsRepository extends BaseRepository {
    create(orgId: string, domain: string, token: string, metadata: Record<string, unknown>): Promise<VerifiedDomainRow>;
    find(orgId: string, id: string, db?: PoolClient | typeof this.db): Promise<VerifiedDomainRow | null>;
    list(orgId: string, q: CursorPaginationQuery, search?: string, verified?: boolean): Promise<CursorPaginatedResponse<VerifiedDomainRow>>;
    verificationResult(orgId: string, id: string, verified: boolean, actorId: string | null, db: PoolClient): Promise<VerifiedDomainRow>;
    setAutoJoin(orgId: string, id: string, enabled: boolean, db: PoolClient): Promise<VerifiedDomainRow>;
    updateMetadata(orgId: string, id: string, metadata: Record<string, unknown>): Promise<VerifiedDomainRow>;
    softDelete(orgId: string, id: string, db: PoolClient): Promise<boolean>;
    makePrimary(orgId: string, id: string, db: PoolClient): Promise<VerifiedDomainRow>;
    hasIdentityDependency(orgId: string, domain: string, db: PoolClient): Promise<boolean>;
    findVerifiedByDomain(domain: string, excludeOrgId?: string): Promise<VerifiedDomainRow | null>;
    pending(limit: number): Promise<VerifiedDomainRow[]>;
}
//# sourceMappingURL=domains.repository.d.ts.map