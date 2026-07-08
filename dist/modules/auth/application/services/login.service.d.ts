import { type BackupCodeLoginInput, type LoginInput, type LoginMFAVerifyInput } from '../../domain/types.js';
export declare function loginWithEmailPassword(input: LoginInput, ipAddress: string, userAgent: string, clientDeviceType: string, requestId: string): Promise<{
    mfa_required: true;
    challenge_id: string;
    expires_at: Date;
    device_type: string;
    available_methods?: Array<{
        id: string;
        type: string;
        name: string;
    }>;
} | {
    mfa_required: false;
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: 'Bearer';
    session_id: string;
    user_id: string;
}>;
export declare function switchLoginMfaMethod(challengeId: string, deviceId: string): Promise<{
    message: string;
}>;
export declare function verifyLoginMFAChallenge(input: LoginMFAVerifyInput, ipAddress: string, userAgent: string, clientDeviceType: string, requestId: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: 'Bearer';
    session_id: string;
    user_id: string;
}>;
export declare function verifyLoginBackupCode(input: BackupCodeLoginInput, ipAddress: string, userAgent: string, clientDeviceType: string, requestId: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: 'Bearer';
    session_id: string;
    user_id: string;
}>;
//# sourceMappingURL=login.service.d.ts.map