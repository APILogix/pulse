import { randomBytes } from 'crypto';
import { promises as dns } from 'dns';
import type { FastifyBaseLogger } from 'fastify';
import { ConflictError, NotFoundError, ValidationError } from '../shared/errors.js';
import type { RequestMeta, OrgRole } from '../shared/types.js';
import { DomainsRepository } from './domains.repository.js';
import type { VerifiedDomainRow } from './domains.schema.js';

/**
 * Public, free webmail provider domains that cannot be verified as corporate domains.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com',
  'outlook.com', 'live.com', 'icloud.com', 'me.com',
  'aol.com', 'proton.me', 'protonmail.com', 'gmx.com',
  'mail.com', 'zoho.com',
]);

/**
 * Prohibited internal or special-use top-level domains.
 */
const INTERNAL_TLD_SUFFIXES = [
  '.local', '.internal', '.corp', '.lan', '.arpa',
  '.test', '.example', '.invalid', '.localhost',
];

/**
 * Validates that a domain is a corporate, registrable public domain.
 * Blocks SSRF vectors including IPv4, IPv6, localhost, internal TLDs, and free mail providers.
 *
 * @param domain - The domain name to validate
 * @throws {ValidationError} When the domain is invalid, private, or prohibited
 */
function validateCorporateDomain(domain: string): void {
  if (!domain || typeof domain !== 'string') {
    throw new ValidationError('A valid domain is required');
  }

  const normalized = domain.trim().toLowerCase();

  // Basic format and length checks
  if (normalized.length > 253 || !normalized.includes('.')) {
    throw new ValidationError('A company-owned registrable domain is required');
  }

  // Reject public email providers
  if (PUBLIC_EMAIL_DOMAINS.has(normalized)) {
    throw new ValidationError('Public email domains cannot be verified for organizations');
  }

  // Reject wildcards, user credentials, schemes
  if (normalized.includes('*') || normalized.includes('@') || normalized.includes('/') || normalized.includes(':')) {
    throw new ValidationError('Domain contains invalid characters or credentials');
  }

  // Reject localhost and loopbacks
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    throw new ValidationError('Localhost cannot be verified');
  }

  // Reject IPv4 addresses
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) {
    throw new ValidationError('IP addresses cannot be verified as organization domains');
  }

  // Reject IPv6 addresses
  if (/^\[?[0-9a-fA-F:]+\]?$/.test(normalized)) {
    throw new ValidationError('IP addresses cannot be verified as organization domains');
  }

  // Reject internal / private TLDs (SSRF prevention)
  if (INTERNAL_TLD_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    throw new ValidationError('Internal and special-use domains cannot be verified');
  }

  // Ensure standard domain name structure (labels separated by dots)
  const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  if (!domainRegex.test(normalized)) {
    throw new ValidationError('Domain name format is invalid');
  }
}

/**
 * Converts a database verified domain row to its external DTO representation.
 */
function toDomainDto(r: VerifiedDomainRow) {
  return {
    id: r.id,
    domain: r.domain,
    isPrimary: r.is_primary,
    isVerified: r.is_verified,
    autoJoinEnabled: r.auto_join_enabled,
    verificationMethod: r.verification_method,
    verificationStartedAt: r.verification_started_at,
    verifiedAt: r.verified_at,
    lastVerificationCheckAt: r.last_verification_check_at,
    metadata: r.metadata,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Service managing corporate domain verification, DNS TXT challenge validation,
 * and SSO auto-join policies for organizations.
 */
export class DomainsService {
  constructor(
    private readonly repo: DomainsRepository,
    private readonly requireMember: (orgId: string, userId: string, minRole?: OrgRole) => Promise<unknown>,
    private readonly audit: (meta: RequestMeta, data: any) => Promise<void>,
    private readonly log: FastifyBaseLogger,
    private readonly resolveTxt: (domain: string) => Promise<string[][]> = dns.resolveTxt,
  ) {}

  /**
   * Lists verified and pending domains for an organization.
   */
  async list(meta: RequestMeta, org: string, q: any) {
    await this.requireMember(org, meta.actorUserId, 'viewer');
    const result = await this.repo.list(org, q, q.search, q.verified);
    return {
      data: result.data.map(toDomainDto),
      meta: result.meta,
    };
  }

  /**
   * Retrieves details of a specific domain by ID.
   */
  async get(meta: RequestMeta, org: string, id: string) {
    await this.requireMember(org, meta.actorUserId, 'viewer');
    const domain = await this.repo.find(org, id);
    if (!domain) {
      throw new NotFoundError('Verified domain');
    }
    return toDomainDto(domain);
  }

  /**
   * Registers a new custom domain for verification and generates a DNS TXT challenge token.
   */
  async create(meta: RequestMeta, org: string, domain: string, metadata: Record<string, unknown> = {}) {
    await this.requireMember(org, meta.actorUserId, 'owner');
    validateCorporateDomain(domain);

    const normalizedDomain = domain.trim().toLowerCase();
    const existingVerified = await this.repo.findVerifiedByDomain(normalizedDomain, org);
    if (existingVerified) {
      throw new ConflictError('Domain is already verified by another organization');
    }

    const token = `pulse-verification=${randomBytes(32).toString('base64url')}`;
    try {
      const created = await this.repo.create(org, normalizedDomain, token, metadata);
      await this.audit(meta, {
        orgId: org,
        action: 'organization.domain_added',
        entityType: 'organization_domain',
        entityId: created.id,
        entityName: normalizedDomain,
        newValues: { domain: normalizedDomain },
        isSensitive: true,
      });
      return {
        ...toDomainDto(created),
        dnsInstructions: {
          recordType: 'TXT',
          host: normalizedDomain,
          value: token,
        },
      };
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictError('Domain is already claimed by an organization');
      }
      throw e;
    }
  }

  /**
   * Initiates DNS TXT record check for a domain. Requires organization owner.
   */
  async verify(meta: RequestMeta, org: string, id: string) {
    await this.requireMember(org, meta.actorUserId, 'owner');
    return this.verifyInternal(org, id, meta);
  }

  /**
   * Internal verification worker with leak-free DNS resolution.
   * Cleans up timers in a finally block to prevent event loop retention.
   */
  async verifyInternal(org: string, id: string, meta?: RequestMeta) {
    const current = await this.repo.find(org, id);
    if (!current) {
      throw new NotFoundError('Verified domain');
    }

    let ok = false;
    let timerHandle: NodeJS.Timeout | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timerHandle = setTimeout(() => reject(new Error('DNS lookup timed out')), 5000);
      });

      const records = await Promise.race([
        this.resolveTxt(current.domain),
        timeoutPromise,
      ]);
      ok = records.flat().includes(current.verification_token ?? '');
    } catch (e) {
      this.log.info({ err: e, domain: current.domain }, 'Domain TXT lookup did not verify');
    } finally {
      if (timerHandle) {
        clearTimeout(timerHandle);
      }
    }

    const updated = await this.repo.withTransaction(async (client) =>
      this.repo.verificationResult(org, id, ok, meta?.actorUserId ?? null, client)
    );

    if (meta) {
      await this.audit(meta, {
        orgId: org,
        action: ok ? 'organization.domain_verification_succeeded' : 'organization.domain_verification_failed',
        entityType: 'organization_domain',
        entityId: id,
        entityName: current.domain,
        status: ok ? 'success' : 'failure',
        failureReason: ok ? undefined : 'Required TXT record not found',
        isSensitive: true,
      });
    }

    return { ...toDomainDto(updated), verified: ok };
  }

  /**
   * Toggles automatic joining of new users with matching verified domain emails.
   */
  async autoJoin(meta: RequestMeta, org: string, id: string, enabled: boolean) {
    await this.requireMember(org, meta.actorUserId, 'owner');
    const result = await this.repo.withTransaction(async (client) => {
      const domain = await this.repo.find(org, id, client);
      if (!domain) {
        throw new NotFoundError('Verified domain');
      }
      if (enabled && !domain.is_verified) {
        throw new ConflictError('Domain must be verified before enabling auto join');
      }
      return this.repo.setAutoJoin(org, id, enabled, client);
    });

    await this.audit(meta, {
      orgId: org,
      action: enabled ? 'organization.domain_auto_join_enabled' : 'organization.domain_auto_join_disabled',
      entityType: 'organization_domain',
      entityId: id,
      entityName: result.domain,
      isSensitive: true,
    });

    return toDomainDto(result);
  }

  /**
   * Updates metadata associated with a domain.
   */
  async update(meta: RequestMeta, org: string, id: string, metadata: Record<string, unknown>) {
    await this.requireMember(org, meta.actorUserId, 'owner');
    const result = await this.repo.updateMetadata(org, id, metadata);
    if (!result) {
      throw new NotFoundError('Verified domain');
    }
    return toDomainDto(result);
  }

  /**
   * Soft-deletes a domain, ensuring no active SSO or SCIM configurations depend on it.
   */
  async delete(meta: RequestMeta, org: string, id: string) {
    await this.requireMember(org, meta.actorUserId, 'owner');
    await this.repo.withTransaction(async (client) => {
      const domain = await this.repo.find(org, id, client);
      if (!domain) {
        throw new NotFoundError('Verified domain');
      }
      if (await this.repo.hasIdentityDependency(org, domain.domain, client)) {
        throw new ConflictError('Domain is used by active SSO or SCIM configuration');
      }
      if (!await this.repo.softDelete(org, id, client)) {
        throw new NotFoundError('Verified domain');
      }
    });

    await this.audit(meta, {
      orgId: org,
      action: 'organization.domain_deleted',
      entityType: 'organization_domain',
      entityId: id,
      isSensitive: true,
    });
  }

  /**
   * Designates a verified domain as the primary domain for the organization.
   */
  async primary(meta: RequestMeta, org: string, id: string) {
    await this.requireMember(org, meta.actorUserId, 'owner');
    const result = await this.repo.withTransaction((client) => this.repo.makePrimary(org, id, client));
    if (!result) {
      throw new ConflictError('Only a verified active domain can be primary');
    }

    await this.audit(meta, {
      orgId: org,
      action: 'organization.primary_domain_changed',
      entityType: 'organization_domain',
      entityId: id,
      entityName: result.domain,
      isSensitive: true,
    });

    return toDomainDto(result);
  }

  /**
   * Batch verifies all pending domains across organizations up to a specified limit.
   */
  async verifyPending(limit = 200) {
    const rows = await this.repo.pending(limit);
    let verified = 0;
    for (const row of rows) {
      const result = await this.verifyInternal(row.organization_id, row.id);
      if (result.verified) {
        verified++;
      }
    }
    return { checked: rows.length, verified };
  }
}
