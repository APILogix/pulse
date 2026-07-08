import { Authenticator } from '@fastify/passport';
import type { FastifyInstance } from 'fastify';
import type { LinkableProvider } from '../../infrastructure/config/identity-link.config.js';
export interface PassportSocialProfile {
    provider: LinkableProvider;
    subject: string;
    email: string | null;
    displayName: string | null;
    profileMetadata: Record<string, unknown>;
}
export declare const socialPassport: Authenticator;
export declare function registerPassportSocialAuth(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=passport-social.service.d.ts.map