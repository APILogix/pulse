/**
 * SAML federation (ACS/metadata) routes.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { getClientInfo } from '../../../../shared/utils/request.js';

import { handleAuthError } from './index.js';
import * as saml from '../../application/services/saml.service.js';
import { getRefreshCookieOptions, REFRESH_COOKIE_NAME } from '../../presentation/cookies.js';
import { env } from '../../../../config/env.js';
import {
  ssoCallbackRateLimit,
} from '../../presentation/middleware/rate-limits.js';

function setRefreshCookie(
  reply: FastifyReply,
  refreshToken: string,
  expiresAt: Date,
): void {
  reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...getRefreshCookieOptions(),
    expires: expiresAt,
  });
}

function frontendAuthCallbackUrl(): string {
  const base = (env.FRONTEND_URL || env.APP_URL).replace(/\/+$/, '');
  return `${base}/auth/callback`;
}

export default async function samlIdentityRoutes(fastify: FastifyInstance) {
  // GET /auth/saml/metadata — SP metadata for IdP configuration
  fastify.get('/saml/metadata', async (_request, reply) => {
    const xml = saml.generateSpMetadata();
    return reply.type('application/xml').send(xml);
  });

  // POST /auth/saml/acs — SAML Assertion Consumer Service (IdP POST binding)
  fastify.post(
    '/saml/acs',
    {
      preHandler: [ssoCallbackRateLimit],
      config: { rawBody: true },
    },
    async (request, reply) => {
      try {
        const body = request.body as {
          SAMLResponse?: string;
          RelayState?: string;
        };
        if (!body?.SAMLResponse) {
          return reply.status(400).send({
            error: {
              code: 'SAML_RESPONSE_INVALID',
              message: 'Missing SAMLResponse',
            },
          });
        }
        const ci = getClientInfo(request);
        const tokens = await saml.completeSamlAcs(
          {
            SAMLResponse: body.SAMLResponse,
            ...(body.RelayState !== undefined ? { RelayState: body.RelayState } : {}),
          },
          ci.ip,
          ci.userAgent,
          request.id,
        );
        setRefreshCookie(reply, tokens.refresh_token, tokens.expires_at);
        return reply.redirect(frontendAuthCallbackUrl());
      } catch (error: any) {
        return handleAuthError(error, reply, request);
      }
    },
  );
}
