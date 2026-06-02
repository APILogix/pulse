import { type SocialLoginInput } from './types.js';
export declare function startSocialLogin(provider: string, input: SocialLoginInput, ipAddress: string, userAgent: string, requestId: string): Promise<{
    authorization_url: string;
    state: string;
}>;
export declare function completeSocialLogin(callbackUrl: string, ipAddress: string, userAgent: string, requestId: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: 'Bearer';
    session_id: string;
    user_id: string;
}>;
//# sourceMappingURL=social-login.service.d.ts.map