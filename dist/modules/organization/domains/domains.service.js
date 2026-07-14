import { randomBytes } from 'crypto';
import { promises as dns } from 'dns';
import { ConflictError, NotFoundError, ValidationError } from '../shared/errors.js';
import { DomainsRepository } from './domains.repository.js';
const PUBLIC = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com']);
function valid(domain) { if (PUBLIC.has(domain) || domain === 'localhost' || domain.includes('*') || domain.includes('@') || /^\d+\.\d+\.\d+\.\d+$/.test(domain))
    throw new ValidationError('A company-owned registrable domain is required'); }
function dto(r) { return { id: r.id, domain: r.domain, isPrimary: r.is_primary, isVerified: r.is_verified, autoJoinEnabled: r.auto_join_enabled, verificationMethod: r.verification_method, verificationStartedAt: r.verification_started_at, verifiedAt: r.verified_at, lastVerificationCheckAt: r.last_verification_check_at, metadata: r.metadata, createdAt: r.created_at, updatedAt: r.updated_at }; }
export class DomainsService {
    repo;
    requireMember;
    audit;
    log;
    resolveTxt;
    constructor(repo, requireMember, audit, log, resolveTxt = dns.resolveTxt) {
        this.repo = repo;
        this.requireMember = requireMember;
        this.audit = audit;
        this.log = log;
        this.resolveTxt = resolveTxt;
    }
    async list(meta, org, q) { await this.requireMember(org, meta.actorUserId, 'viewer'); const x = await this.repo.list(org, q, q.search, q.verified); return { data: x.data.map(dto), meta: x.meta }; }
    async get(meta, org, id) { await this.requireMember(org, meta.actorUserId, 'viewer'); const x = await this.repo.find(org, id); if (!x)
        throw new NotFoundError('Verified domain'); return dto(x); }
    async create(meta, org, domain, metadata = {}) { await this.requireMember(org, meta.actorUserId, 'owner'); valid(domain); const existingVerified = await this.repo.findVerifiedByDomain(domain, org); if (existingVerified)
        throw new ConflictError('Domain is already verified by another organization'); const token = `pulse-verification=${randomBytes(32).toString('base64url')}`; try {
        const r = await this.repo.create(org, domain, token, metadata);
        await this.audit(meta, { orgId: org, action: 'organization.domain_added', entityType: 'organization_domain', entityId: r.id, entityName: domain, newValues: { domain }, isSensitive: true });
        return { ...dto(r), dnsInstructions: { recordType: 'TXT', host: domain, value: token } };
    }
    catch (e) {
        if (e?.code === '23505')
            throw new ConflictError('Domain is already claimed by an organization');
        throw e;
    } }
    async verify(meta, org, id) { await this.requireMember(org, meta.actorUserId, 'owner'); return this.verifyInternal(org, id, meta); }
    async verifyInternal(org, id, meta) { const current = await this.repo.find(org, id); if (!current)
        throw new NotFoundError('Verified domain'); let ok = false; try {
        const records = await Promise.race([this.resolveTxt(current.domain), new Promise((_, rej) => setTimeout(() => rej(new Error('DNS lookup timed out')), 5000))]);
        ok = records.flat().includes(current.verification_token ?? '');
    }
    catch (e) {
        this.log.info({ err: e, domain: current.domain }, 'Domain TXT lookup did not verify');
    } const updated = await this.repo.withTransaction(async (c) => this.repo.verificationResult(org, id, ok, meta?.actorUserId ?? null, c)); if (meta)
        await this.audit(meta, { orgId: org, action: ok ? 'organization.domain_verification_succeeded' : 'organization.domain_verification_failed', entityType: 'organization_domain', entityId: id, entityName: current.domain, status: ok ? 'success' : 'failure', failureReason: ok ? undefined : 'Required TXT record not found', isSensitive: true }); return { ...dto(updated), verified: ok }; }
    async autoJoin(meta, org, id, enabled) { await this.requireMember(org, meta.actorUserId, 'owner'); const r = await this.repo.withTransaction(async (c) => { const d = await this.repo.find(org, id, c); if (!d)
        throw new NotFoundError('Verified domain'); if (enabled && !d.is_verified)
        throw new ConflictError('Domain must be verified before enabling auto join'); return this.repo.setAutoJoin(org, id, enabled, c); }); await this.audit(meta, { orgId: org, action: enabled ? 'organization.domain_auto_join_enabled' : 'organization.domain_auto_join_disabled', entityType: 'organization_domain', entityId: id, entityName: r.domain, isSensitive: true }); return dto(r); }
    async update(meta, org, id, metadata) { await this.requireMember(org, meta.actorUserId, 'owner'); const r = await this.repo.updateMetadata(org, id, metadata); if (!r)
        throw new NotFoundError('Verified domain'); return dto(r); }
    async delete(meta, org, id) { await this.requireMember(org, meta.actorUserId, 'owner'); await this.repo.withTransaction(async (c) => { const d = await this.repo.find(org, id, c); if (!d)
        throw new NotFoundError('Verified domain'); if (await this.repo.hasIdentityDependency(org, d.domain, c))
        throw new ConflictError('Domain is used by active SSO or SCIM configuration'); if (!await this.repo.softDelete(org, id, c))
        throw new NotFoundError('Verified domain'); }); await this.audit(meta, { orgId: org, action: 'organization.domain_deleted', entityType: 'organization_domain', entityId: id, isSensitive: true }); }
    async primary(meta, org, id) { await this.requireMember(org, meta.actorUserId, 'owner'); const r = await this.repo.withTransaction(c => this.repo.makePrimary(org, id, c)); if (!r)
        throw new ConflictError('Only a verified active domain can be primary'); await this.audit(meta, { orgId: org, action: 'organization.primary_domain_changed', entityType: 'organization_domain', entityId: id, entityName: r.domain, isSensitive: true }); return dto(r); }
    async verifyPending(limit = 200) { const rows = await this.repo.pending(limit); let verified = 0; for (const row of rows) {
        const r = await this.verifyInternal(row.organization_id, row.id);
        if (r.verified)
            verified++;
    } return { checked: rows.length, verified }; }
}
//# sourceMappingURL=domains.service.js.map