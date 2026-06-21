/**
 * Account administration: WebAuthn step-up, MFA device management, admin password reset.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  authenticate,
  requireAdmin,
} from '../../shared/middleware/auth.js';
import { getClientInfo } from '../../shared/utils/request.js';

import { handleAuthError } from './routes.js';
import * as service from './service.js';
import * as webauthn from './webauthn.service.js';
import { loginMfaRateLimit, webauthnRateLimit } from './rate-limits.js';
import {
  AdminForcePasswordResetSchema,
  MFADeviceRenameSchema,
  WebAuthnStepUpOptionsSchema,
  WebAuthnStepUpVerifySchema,
} from './types.js';

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

export default async function accountAdministrationRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/mfa/step-up/webauthn/options',
    { preHandler: [authenticate, webauthnRateLimit] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = WebAuthnStepUpOptionsSchema.parse(request.body);
        const result = await webauthn.createStepUpWebAuthnOptions(
          body.challenge_id,
          r.user.id,
        );
        return reply.send({ data: result });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.post(
    '/mfa/step-up/webauthn/verify',
    { preHandler: [authenticate, loginMfaRateLimit] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const body = WebAuthnStepUpVerifySchema.parse(request.body);
        const { ip } = getClientInfo(request);
        const result = await webauthn.verifyStepUpWebAuthn(
          body,
          r.user.sessionId,
          r.user.id,
          ip,
        );
        return reply.send({ data: result });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.patch(
    '/mfa/devices/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = request.params as { id: string };
        const body = MFADeviceRenameSchema.parse(request.body);
        await service.renameMFADevice(r.user.id, id, body);
        return reply.send({ message: 'Device renamed' });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );

  fastify.post(
    '/users/:id/password/reset',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      try {
        const r = request as RequestWithUser;
        const { id } = request.params as { id: string };
        const body = AdminForcePasswordResetSchema.parse(request.body ?? {});
        const { ip } = getClientInfo(request);
        const result = await service.adminForcePasswordReset(
          id,
          r.user.id,
          r.user.isAdmin,
          {
            ...(body.reason !== undefined ? { reason: body.reason } : {}),
          },
          ip,
          request.id,
        );
        return reply.send({ data: result });
      } catch (error) {
        return handleAuthError(error, reply, request);
      }
    },
  );
}
