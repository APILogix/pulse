import { createHash, randomBytes } from 'crypto';
import type { PoolClient } from 'pg';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import * as repository from '../auth/repository.js';
import { withTransaction } from '../auth/repository.js';
import { logAudit } from '../../shared/middleware/audit-logger.js';

const tokenLogger = logger.child({ component: 'scim-token-service' });

export interface CreateScimTokenInput {
  orgId: string;
  createdBy: string;
  scopes: string[];
  allowedIps?: string[];
  expiresInDays?: number;
}

function hashScimToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class ScimTokenService {
  async createToken(
    input: CreateScimTokenInput,
  ): Promise<{ rawToken: string; tokenId: string }> {
    return withTransaction(async (client) => {
      return this.createTokenInTransaction(input, client);
    });
  }

  async rotateToken(
    tokenId: string,
    rotatedBy: string,
  ): Promise<{ rawToken: string; newTokenId: string }> {
    return withTransaction(async (client) => {
      const existing = await repository.findScimTokenById(tokenId, client);
      if (!existing) {
        throw new Error('Token not found');
      }
      if (existing.revoked_at) {
        throw new Error('Token already revoked');
      }

      const scopes = await repository.listScimTokenScopes(tokenId, client);
      const allowedIps = await repository.listScimTokenIps(tokenId, client);
      const created = await this.createTokenInTransaction({
        orgId: existing.org_id,
        createdBy: rotatedBy,
        scopes,
        allowedIps,
      }, client);

      const gracePeriodEndsAt = new Date(
        Date.now() + env.SCIM_TOKEN_GRACE_PERIOD_MINUTES * 60000,
      );
      await repository.rotateScimToken(tokenId, created.tokenId, gracePeriodEndsAt, client);

      logAudit({
        user_id: rotatedBy,
        org_id: existing.org_id,
        actor_type: 'admin',
        actor_id: rotatedBy,
        action: 'scim_token.rotated',
        resource_type: 'scim_token',
        resource_id: tokenId,
        ip_address: '0.0.0.0',
        request_id: 'scim-token-service',
        metadata: { new_token_id: created.tokenId },
      });

      return { rawToken: created.rawToken, newTokenId: created.tokenId };
    });
  }

  async revokeToken(tokenId: string, revokedBy: string): Promise<void> {
    const existing = await repository.findScimTokenById(tokenId);
    await repository.revokeScimToken(tokenId);

    logAudit({
      user_id: revokedBy,
      org_id: existing?.org_id ?? null,
      actor_type: 'admin',
      actor_id: revokedBy,
      action: 'scim_token.revoked',
      resource_type: 'scim_token',
      resource_id: tokenId,
      ip_address: '0.0.0.0',
      request_id: 'scim-token-service',
    });
  }

  async listTokens(orgId: string) {
    return repository.listScimTokensForOrg(orgId);
  }

  private async createTokenInTransaction(
    input: CreateScimTokenInput,
    client: PoolClient,
  ): Promise<{ rawToken: string; tokenId: string }> {
    const rawToken = `scim_${randomBytes(32).toString('hex')}`;
    const tokenHash = hashScimToken(rawToken);
    const expiresAt = new Date(
      Date.now() + (input.expiresInDays ?? env.SCIM_DEFAULT_TOKEN_EXPIRY_DAYS) * 86400000,
    );

    const created = await repository.createScimToken(
      {
        orgId: input.orgId,
        tokenHash,
        createdBy: input.createdBy,
        expiresAt,
      },
      client,
    );

    await repository.insertScimTokenScopes(created.id, input.scopes, client);
    await repository.insertScimTokenIps(created.id, input.allowedIps ?? [], client);

    logAudit({
      user_id: input.createdBy,
      org_id: input.orgId,
      actor_type: 'admin',
      actor_id: input.createdBy,
      action: 'scim_token.created',
      resource_type: 'scim_token',
      resource_id: created.id,
      ip_address: '0.0.0.0',
      request_id: 'scim-token-service',
      metadata: { scopes: input.scopes, ip_count: input.allowedIps?.length ?? 0 },
    });

    tokenLogger.info({ tokenId: created.id, orgId: input.orgId }, 'SCIM token created');
    return { rawToken, tokenId: created.id };
  }
}
