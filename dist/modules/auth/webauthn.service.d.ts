/**

 * WebAuthn / passkey registration and login MFA (@simplewebauthn/server).

 *

 * Challenges live in-process LRU (`webauthnChallengeCache`). Credentials in

 * `user_mfa_devices` with `device_type = hardware_key`.

 */
import { generateAuthenticationOptions, generateRegistrationOptions } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { type WebAuthnRegisterVerifyInput, type WebAuthnLoginMfaVerifyInput, type WebAuthnStepUpVerifyInput } from './types.js';
export declare function createWebAuthnRegistrationOptions(userId: string, deviceName: string): Promise<{
    options: Awaited<ReturnType<typeof generateRegistrationOptions>>;
}>;
export declare function verifyWebAuthnRegistration(userId: string, input: WebAuthnRegisterVerifyInput, ipAddress: string, requestId: string): Promise<{
    device_id: string;
    backup_codes: string[];
}>;
export declare function createWebAuthnAuthenticationOptions(userId: string): Promise<{
    options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
}>;
export declare function verifyWebAuthnAuthentication(userId: string, response: AuthenticationResponseJSON, challenge: string, ipAddress: string): Promise<{
    verified: true;
}>;
export declare function createLoginMfaWebAuthnOptions(challengeId: string): Promise<{
    options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
    challenge: string;
}>;
export declare function verifyLoginMfaWebAuthn(input: WebAuthnLoginMfaVerifyInput, ipAddress: string, userAgent: string, clientDeviceType: string, requestId: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: 'Bearer';
    session_id: string;
    user_id: string;
}>;
export declare function createStepUpWebAuthnOptions(challengeId: string, userId: string): Promise<{
    options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
    challenge: string;
}>;
export declare function verifyStepUpWebAuthn(input: WebAuthnStepUpVerifyInput, sessionId: string, userId: string, ipAddress: string): Promise<{
    user_id: string;
    mfa_verified: true;
}>;
//# sourceMappingURL=webauthn.service.d.ts.map