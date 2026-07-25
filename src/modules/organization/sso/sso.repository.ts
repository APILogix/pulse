import { BaseRepository, cursorPage } from "../shared/base.repository.js";
import { ConflictError, NotFoundError } from "../shared/errors.js";
import type { OrgSsoProviderRow } from "./sso.schema.js";
import type { CursorPaginationQuery, CursorPaginatedResponse } from "../shared/types.js";
export class SsoRepository extends BaseRepository {
  async createSsoProvider(orgId: string, data: Record<string, unknown>): Promise<OrgSsoProviderRow> {
    const r = await this.db.query<OrgSsoProviderRow>(
      `INSERT INTO organization_sso_providers (org_id,provider_name,provider_type,entity_id,sso_url,x509_certificate,domain) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,org_id,provider_name,provider_type,entity_id,sso_url,domain,is_active,created_at`,
      [orgId, data.providerName, data.providerType, data.entityId ?? null, data.ssoUrl ?? null, data.x509Certificate ?? null, data.domain ?? null]
    );
    return r.rows[0]!;
  }

  async listSsoProviders(orgId: string, q: CursorPaginationQuery): Promise<CursorPaginatedResponse<OrgSsoProviderRow>> {
    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM organization_sso_providers WHERE org_id=$1`, [orgId]
    );
    const totalCount = Number(countRes.rows[0]?.count ?? 0);

    const params: unknown[] = [orgId];
    let where = `org_id=$1`;
    if (q.cursor) { params.push(q.cursor); where += ` AND created_at < $${params.length}`; }
    params.push(q.limit + 1);

    const r = await this.db.query<OrgSsoProviderRow>(
      `SELECT id,org_id,provider_name,provider_type,entity_id,sso_url,domain,is_active,created_at
       FROM organization_sso_providers WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
    );
    return cursorPage(r.rows, q.limit, totalCount);
  }

  async updateSsoProvider(orgId: string, ssoId: string, data: Record<string, unknown>): Promise<OrgSsoProviderRow> {
    const cols: string[] = []; const vals: unknown[] = [];
    const map: Record<string, string> = { providerName: 'provider_name', entityId: 'entity_id', ssoUrl: 'sso_url', x509Certificate: 'x509_certificate', domain: 'domain', isActive: 'is_active' };
    for (const [k, v] of Object.entries(data)) { if (v !== undefined && map[k]) { cols.push(`${map[k]}=$${cols.length + 3}`); vals.push(v); } }
    if (cols.length === 0) throw new ConflictError("No fields to update");
    const r = await this.db.query<OrgSsoProviderRow>(
      `UPDATE organization_sso_providers SET ${cols.join(',')} WHERE org_id=$1 AND id=$2
       RETURNING id,org_id,provider_name,provider_type,entity_id,sso_url,domain,is_active,created_at`, [orgId, ssoId, ...vals]
    );
    if (!r.rows[0]) throw new NotFoundError("SSO Provider");
    return r.rows[0];
  }

  async deleteSsoProvider(orgId: string, ssoId: string): Promise<void> {
    const r = await this.db.query(`DELETE FROM organization_sso_providers WHERE org_id=$1 AND id=$2`, [orgId, ssoId]);
    if (r.rowCount === 0) throw new NotFoundError("SSO Provider");
  }
}
