import { BaseRepository, cursorPage } from '../shared/base.repository.js';
const columns = 'id,organization_id,domain,is_primary,is_verified,auto_join_enabled,verification_method,verification_token,verification_started_at,verified_at,verified_by,last_verification_check_at,metadata,created_at,updated_at,deleted_at';
export class DomainsRepository extends BaseRepository {
    async create(orgId, domain, token, metadata) { const r = await this.db.query(`INSERT INTO organization_verified_domains (organization_id,domain,verification_method,verification_token,verification_started_at,metadata) VALUES ($1,$2,'dns_txt',$3,NOW(),$4::jsonb) RETURNING ${columns}`, [orgId, domain, token, JSON.stringify(metadata)]); return r.rows[0]; }
    async find(orgId, id, db = this.db) { const r = await db.query(`SELECT ${columns} FROM organization_verified_domains WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL`, [orgId, id]); return r.rows[0] ?? null; }
    async list(orgId, q, search, verified) { const p = [orgId]; let w = 'organization_id=$1 AND deleted_at IS NULL'; if (search) {
        p.push(`%${search.toLowerCase()}%`);
        w += ` AND domain ILIKE $${p.length}`;
    } if (verified !== undefined) {
        p.push(verified);
        w += ` AND is_verified=$${p.length}`;
    } if (q.cursor) {
        p.push(q.cursor);
        w += ` AND created_at < $${p.length}`;
    } p.push(q.limit + 1); const r = await this.db.query(`SELECT ${columns} FROM organization_verified_domains WHERE ${w} ORDER BY created_at DESC LIMIT $${p.length}`, p); return cursorPage(r.rows, q.limit); }
    async verificationResult(orgId, id, verified, actorId, db) { const r = await db.query(`UPDATE organization_verified_domains SET last_verification_check_at=NOW(),is_verified=CASE WHEN $3 THEN TRUE ELSE is_verified END,verified_at=CASE WHEN $3 THEN NOW() ELSE verified_at END,verified_by=CASE WHEN $3 THEN $4::uuid ELSE verified_by END WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING ${columns}`, [orgId, id, verified, actorId]); return r.rows[0]; }
    async setAutoJoin(orgId, id, enabled, db) { const r = await db.query(`UPDATE organization_verified_domains SET auto_join_enabled=$3 WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING ${columns}`, [orgId, id, enabled]); return r.rows[0]; }
    async updateMetadata(orgId, id, metadata) { const r = await this.db.query(`UPDATE organization_verified_domains SET metadata=$3::jsonb WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING ${columns}`, [orgId, id, JSON.stringify(metadata)]); return r.rows[0]; }
    async softDelete(orgId, id, db) { const r = await db.query(`UPDATE organization_verified_domains SET deleted_at=NOW(),auto_join_enabled=FALSE WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL`, [orgId, id]); return r.rowCount === 1; }
    async makePrimary(orgId, id, db) { await db.query(`UPDATE organization_verified_domains SET is_primary=FALSE WHERE organization_id=$1 AND deleted_at IS NULL AND is_primary=TRUE`, [orgId]); const r = await db.query(`UPDATE organization_verified_domains SET is_primary=TRUE WHERE organization_id=$1 AND id=$2 AND is_verified=TRUE AND deleted_at IS NULL RETURNING ${columns}`, [orgId, id]); return r.rows[0]; }
    async hasIdentityDependency(orgId, domain, db) { const r = await db.query(`SELECT EXISTS(SELECT 1 FROM organization_sso_providers WHERE org_id=$1 AND lower(domain)=$2 AND is_active=TRUE) OR EXISTS(SELECT 1 FROM organization_scim_tokens WHERE org_id=$1 AND revoked_at IS NULL) AS x`, [orgId, domain]); return r.rows[0]?.x ?? false; }
    async findVerifiedByDomain(domain, excludeOrgId) { const r = await this.db.query(`SELECT ${columns} FROM organization_verified_domains WHERE domain=$1 AND is_verified=TRUE AND deleted_at IS NULL${excludeOrgId ? ` AND organization_id!=$2` : ''}`, excludeOrgId ? [domain, excludeOrgId] : [domain]); return r.rows[0] ?? null; }
    async pending(limit) { const r = await this.db.query(`SELECT ${columns} FROM organization_verified_domains WHERE deleted_at IS NULL AND is_verified=FALSE AND verification_token IS NOT NULL ORDER BY last_verification_check_at NULLS FIRST,created_at ASC LIMIT $1`, [limit]); return r.rows; }
}
//# sourceMappingURL=domains.repository.js.map