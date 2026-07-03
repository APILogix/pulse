/**
 * Phase 3 identity & compliance routes.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  authenticate,
  requireAdmin,
  requireStepUp,
} from '../../shared/middleware/auth.js';
import { getClientInfo } from '../../shared/utils/request.js';

import * as identity from './identity.service.js';
import {
  accountUnlockRequestRateLimit,
  ssoDiscoveryRateLimit,
  tokenConfirmRateLimit,
} from './rate-limits.js';
import {
  getEffectiveAuthPolicy,
  getPasswordPolicy,
} from './policy.service.js';
import {
  AccountDeletionConfirmSchema,
  AccountDeletionRequestSchema,
  AccountUnlockConfirmSchema,
  AccountUnlockRequestSchema,
  AdminAuditLogsQuerySchema,
  MfaRecoveryRequestSchema,
  SsoDiscoveryQuerySchema,
} from './types.js';
import { handleAuthError } from './routes.js';

interface RequestWithUser extends FastifyRequest {
  user: {
    id: string;
    email: string;
    isAdmin: boolean;
    sessionId: string;
    mfaVerified: boolean;
    stepUpFresh: boolean;
  };
}

export default async function identityRoutes(fastify: FastifyInstance) {
  // GET /auth/password/policy
  fastify.get('/password/policy', async (_request, reply) => {
    return reply.send({ data: getPasswordPolicy() });
  });

  fastify.get(
    '/users/me/verification',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const status = await identity.getEmailVerificationStatus(r.user.id);
        return reply.send({ data: status });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // GET /auth/policy/effective
  fastify.get(
    '/policy/effective',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const policy = await getEffectiveAuthPolicy(r.user.id);
        return reply.send({ data: policy });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // GET /auth/sso/discovery?email=
  fastify.get(
    '/sso/discovery',
    { preHandler: [ssoDiscoveryRateLimit] },
    async (request, reply) => {
    try {
      const query = SsoDiscoveryQuerySchema.parse(request.query);
      const result = await identity.discoverSso(query);
      return reply.send({ data: result });
    } catch (error) {
      return handleAuthError(error, reply, request);
    }
  },
  );

  // POST /auth/account/unlock/request
  fastify.post(
    '/account/unlock/request',
    { preHandler: [accountUnlockRequestRateLimit] },
    async (request, reply) => {
    try {
      const body = AccountUnlockRequestSchema.parse(request.body);
      const { ip } = getClientInfo(request);
      const result = await identity.requestAccountUnlock(
        body,
        ip,
        request.id,
      );
      return reply.send({ data: result });
    } catch (error) {
      return handleAuthError(error, reply, request);
    }
  },
  );

  // POST /auth/account/unlock/confirm
  fastify.post(
    '/account/unlock/confirm',
    { preHandler: [tokenConfirmRateLimit] },
    async (request, reply) => {
    try {
      const body = AccountUnlockConfirmSchema.parse(request.body);
      const { ip } = getClientInfo(request);
      const result = await identity.confirmAccountUnlock(
        body,
        ip,
        request.id,
      );
      return reply.send({ data: result });
    } catch (error) {
      return handleAuthError(error, reply, request);
    }
  },
  );

  // GET /auth/users/me/export
  fastify.get(
    '/users/me/export',
    { preHandler: [authenticate, requireStepUp] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const data = await identity.exportUserData(r.user.id);
        return reply.send({ data });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/users/me/delete/request
  fastify.post(
    '/users/me/delete/request',
    { preHandler: [authenticate, requireStepUp] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = AccountDeletionRequestSchema.parse(r.body ?? {});
        const { ip } = getClientInfo(r);
        const result = await identity.requestAccountDeletion(
          r.user.id,
          body,
          ip,
          r.id,
        );
        return reply.send({ data: result });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // POST /auth/users/me/delete/confirm
  fastify.post(
    '/users/me/delete/confirm',
    { preHandler: [tokenConfirmRateLimit] },
    async (request, reply) => {
    try {
      const body = AccountDeletionConfirmSchema.parse(request.body);
      const { ip } = getClientInfo(request);
      const result = await identity.confirmAccountDeletion(
        body,
        ip,
        request.id,
      );
      return reply.send({ data: result });
    } catch (error) {
      return handleAuthError(error, reply, request);
    }
  },
  );

  // POST /auth/mfa/recovery/request
  fastify.post(
    '/mfa/recovery/request',
    { preHandler: [authenticate, requireStepUp] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = MfaRecoveryRequestSchema.parse(r.body);
        const { ip } = getClientInfo(r);
        const result = await identity.requestMfaRecovery(
          r.user.id,
          body,
          ip,
          r.id,
        );
        return reply.send({ data: result });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  // GET /auth/users/:id/audit-events (admin)
  fastify.get(
    '/users/:id/audit-events',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = r.params as { id: string };
        const query = AdminAuditLogsQuerySchema.parse(r.query);
        const { ip } = getClientInfo(r);
        const { events, total } = await identity.listUserAuditEvents(
          id,
          r.user.id,
          r.user.isAdmin,
          query,
          ip,
          r.id,
        );
        return reply.send({
          data: events,
          meta: { total, limit: query.limit, offset: query.offset },
        });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );
}
