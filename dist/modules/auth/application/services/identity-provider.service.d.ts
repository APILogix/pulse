import { type LinkableProvider } from '../../infrastructure/config/identity-link.config.js';
import * as repository from '../../infrastructure/repositories/index.js';
import { type SocialLoginInput } from '../../domain/types.js';
import type { PassportSocialProfile } from './passport-social.service.js';
interface CallbackStateResult {
    kind: 'login' | 'link';
    provider: LinkableProvider;
    state: string;
    userId?: string;
    rememberMe?: boolean;
    ipAddress?: string;
    userAgent?: string;
    deviceName?: string;
    clientDeviceType?: string;
}
export declare function frontendAuthCallbackUrl(): string;
export declare function frontendIdentityProvidersUrl(): string;
export declare function startSocialLogin(provider: string, input: SocialLoginInput, ipAddress: string, userAgent: string, requestId: string): Promise<{
    authorization_url: string;
    state: string;
}>;
export declare function startIdentityLink(userId: string, provider: string, ipAddress: string, requestId: string): Promise<{
    authorization_url: string;
    state: string;
}>;
export declare function consumeCallbackState(state: string): CallbackStateResult;
export declare function resolveCallbackState(state: string): CallbackStateResult;
export declare function completeSocialLogin(profile: PassportSocialProfile, flow: CallbackStateResult, ipAddress: string, userAgent: string, requestId: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: 'Bearer';
    session_id: string;
    user_id: string;
}>;
export declare function completeIdentityLink(profile: PassportSocialProfile, flow: CallbackStateResult, ipAddress: string, requestId: string): Promise<{
    id: string;
    provider: LinkableProvider;
    linked_at: Date;
}>;
export declare function listIdentityProviders(userId: string): Promise<{
    id: string;
    provider: repository.LinkedIdentityProvider;
    provider_email: string | null;
    linked_at: Date;
    last_used_at: Date | null;
}[]>;
export declare function unlinkIdentityProvider(userId: string, linkId: string, ipAddress: string, requestId: string): Promise<void>;
export {};
//# sourceMappingURL=identity-provider.service.d.ts.map