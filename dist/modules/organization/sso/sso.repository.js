import { BaseRepository } from "../shared/base.repository.js";
import { ConflictError, NotFoundError } from "../shared/errors.js";
export class SsoRepository extends BaseRepository {
    async createSsoProvider(orgId, data) {
        const r = await this.db.query(`INSERT INTO organization_sso_providers (org_id,provider_name,provider_type,entity_id,sso_url,x509_certificate,domain) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,org_id,provider_name,provider_type,entity_id,sso_url,domain,is_active,created_at`, [orgId, data.providerName, data.providerType, data.entityId ?? null, data.ssoUrl ?? null, data.x509Certificate ?? null, data.domain ?? null]);
        return r.rows[0];
    }
    async listSsoProviders(orgId) {
        const r = await this.db.query(`SELECT id,org_id,provider_name,provider_type,entity_id,sso_url,domain,is_active,created_at
       FROM organization_sso_providers WHERE org_id=$1 ORDER BY created_at DESC`, [orgId]);
        return r.rows;
    }
    async updateSsoProvider(orgId, ssoId, data) {
        const cols = [];
        const vals = [];
        const map = { providerName: 'provider_name', entityId: 'entity_id', ssoUrl: 'sso_url', x509Certificate: 'x509_certificate', domain: 'domain', isActive: 'is_active' };
        for (const [k, v] of Object.entries(data)) {
            if (v !== undefined && map[k]) {
                cols.push(`${map[k]}=$${cols.length + 3}`);
                vals.push(v);
            }
        }
        if (cols.length === 0)
            throw new ConflictError("No fields to update");
        const r = await this.db.query(`UPDATE organization_sso_providers SET ${cols.join(',')} WHERE org_id=$1 AND id=$2
       RETURNING id,org_id,provider_name,provider_type,entity_id,sso_url,domain,is_active,created_at`, [orgId, ssoId, ...vals]);
        if (!r.rows[0])
            throw new NotFoundError("SSO Provider");
        return r.rows[0];
    }
    async deleteSsoProvider(orgId, ssoId) {
        const r = await this.db.query(`DELETE FROM organization_sso_providers WHERE org_id=$1 AND id=$2`, [orgId, ssoId]);
        if (r.rowCount === 0)
            throw new NotFoundError("SSO Provider");
    }
}
//# sourceMappingURL=sso.repository.js.map