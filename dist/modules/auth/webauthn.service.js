/**

 * WebAuthn / passkey registration and login MFA (@simplewebauthn/server).

 *

 * Challenges live in-process LRU (`webauthnChallengeCache`). Credentials in

 * `user_mfa_devices` with `device_type = hardware_key`.

 */
import { createHash, randomBytes } from 'crypto';
import { promisify } from 'util';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { logAudit } from '../../shared/middleware/audit-logger.js';
import { loginMfaChallengeCache, mfaBackupTempCache, recordStepUpFreshness, stepUpChallengeCache, webauthnChallengeCache, } from './cache.js';
import * as repository from './repository.js';
import { assertLoginAllowedByOrgPolicy } from './policy.service.js';
import { issueSessionForUser } from './service.js';
import { AuthError, AuthErrorCodes, } from './types.js';
import { webauthnConfig } from './webauthn.config.js';
const randomBytesAsync = promisify(randomBytes);
async function generateBackupCodes() {
    const codes = [];
    for (let i = 0; i < 10; i++) {
        const bytes = await randomBytesAsync(10);
        codes.push(bytes.toString('hex'));
    }
    const hashed = codes.map((code) => createHash('sha256').update(code).digest('hex'));
    return { plain: codes, hashed };
}
function credentialFromDevice(device) {
    if (!device.credential_id || !device.public_key) {
        throw new AuthError('Passkey credential data missing', AuthErrorCodes.MFA_DEVICE_NOT_FOUND, 500);
    }
    return {
        id: device.credential_id,
        publicKey: isoBase64URL.toBuffer(device.public_key),
        counter: device.sign_count ?? 0,
        transports: [],
    };
}
function listHardwareKeys(devices) {
    return devices.filter((d) => d.device_type === 'hardware_key' &&
        d.verified &&
        d.is_active &&
        d.credential_id);
}
export async function createWebAuthnRegistrationOptions(userId, deviceName) {
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    const devices = await repository.findMFADevicesByUserId(userId);
    const existing = listHardwareKeys(devices);
    const options = await generateRegistrationOptions({
        rpName: webauthnConfig.rpName,
        rpID: webauthnConfig.rpID,
        userName: user.email,
        userDisplayName: user.full_name || user.email,
        userID: new TextEncoder().encode(userId),
        attestationType: 'none',
        excludeCredentials: existing.map((d) => ({
            id: d.credential_id,
        })),
        authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'preferred',
        },
    });
    webauthnChallengeCache.set(options.challenge, {
        userId,
        type: 'registration',
    });
    return { options };
}
export async function verifyWebAuthnRegistration(userId, input, ipAddress, requestId) {
    const state = webauthnChallengeCache.get(input.challenge);
    if (!state || state.type !== 'registration' || state.userId !== userId) {
        throw new AuthError('Registration challenge expired', AuthErrorCodes.WEBAUTHN_CHALLENGE_INVALID, 400);
    }
    webauthnChallengeCache.delete(input.challenge);
    const verification = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: input.challenge,
        expectedOrigin: webauthnConfig.origin,
        expectedRPID: webauthnConfig.rpID,
        requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
        throw new AuthError('Passkey registration failed', AuthErrorCodes.MFA_INVALID, 400);
    }
    const { credential } = verification.registrationInfo;
    const allDevices = await repository.findMFADevicesByUserId(userId);
    const hasOtherPrimary = allDevices.some((d) => d.is_primary && d.is_active);
    const isPrimary = !hasOtherPrimary;
    const device = await repository.createWebAuthnDevice({
        user_id: userId,
        device_name: input.device_name,
        credential_id: credential.id,
        public_key: isoBase64URL.fromBuffer(credential.publicKey),
        sign_count: credential.counter,
        is_primary: isPrimary,
    });
    const { plain, hashed } = await generateBackupCodes();
    mfaBackupTempCache.set(device.id, hashed);
    await repository.withTransaction(async (client) => {
        await repository.verifyMFADevice(device.id, hashed, client);
        if (isPrimary) {
            await repository.updateMFADevicePrimary(userId, device.id, client);
        }
        await repository.updateUserMFAEnabled(userId, true, client);
        await repository.updateBackupCodesGenerated(userId, client);
    });
    mfaBackupTempCache.delete(device.id);
    logAudit({
        user_id: userId,
        org_id: null,
        action: 'user.mfa_enabled',
        resource_type: 'mfa_device',
        resource_id: device.id,
        ip_address: ipAddress,
        request_id: requestId,
        metadata: { device_type: 'hardware_key' },
    });
    return { device_id: device.id, backup_codes: plain };
}
export async function createWebAuthnAuthenticationOptions(userId) {
    const devices = await repository.findMFADevicesByUserId(userId);
    const keys = listHardwareKeys(devices);
    if (keys.length === 0) {
        throw new AuthError('No passkeys registered', AuthErrorCodes.MFA_NOT_ENABLED, 400);
    }
    const options = await generateAuthenticationOptions({
        rpID: webauthnConfig.rpID,
        userVerification: 'preferred',
        allowCredentials: keys.map((d) => ({
            id: d.credential_id,
        })),
    });
    webauthnChallengeCache.set(options.challenge, {
        userId,
        type: 'authentication',
    });
    return { options };
}
export async function verifyWebAuthnAuthentication(userId, response, challenge, ipAddress) {
    const state = webauthnChallengeCache.get(challenge);
    if (!state || state.type !== 'authentication' || state.userId !== userId) {
        throw new AuthError('Authentication challenge expired', AuthErrorCodes.WEBAUTHN_CHALLENGE_INVALID, 400);
    }
    webauthnChallengeCache.delete(challenge);
    const device = await repository.findWebAuthnDeviceByCredentialId(response.id);
    if (!device || device.user_id !== userId) {
        throw new AuthError('Unknown passkey', AuthErrorCodes.MFA_INVALID, 400);
    }
    const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: webauthnConfig.origin,
        expectedRPID: webauthnConfig.rpID,
        credential: credentialFromDevice(device),
        requireUserVerification: true,
    });
    if (!verification.verified) {
        throw new AuthError('Passkey verification failed', AuthErrorCodes.MFA_INVALID, 400);
    }
    await repository.updateWebAuthnSignCount(device.id, verification.authenticationInfo.newCounter, ipAddress);
    return { verified: true };
}
export async function createLoginMfaWebAuthnOptions(challengeId) {
    const loginChallenge = loginMfaChallengeCache.get(challengeId);
    if (!loginChallenge) {
        throw new AuthError('Login challenge expired', AuthErrorCodes.MFA_CHALLENGE_EXPIRED, 400);
    }
    const device = await repository.findMFADeviceById(loginChallenge.deviceId, loginChallenge.userId);
    if (!device || device.device_type !== 'hardware_key' || !device.credential_id) {
        throw new AuthError('This login challenge requires a different MFA method', AuthErrorCodes.MFA_INVALID, 400);
    }
    const options = await generateAuthenticationOptions({
        rpID: webauthnConfig.rpID,
        userVerification: 'preferred',
        allowCredentials: [{ id: device.credential_id }],
    });
    webauthnChallengeCache.set(options.challenge, {
        userId: loginChallenge.userId,
        type: 'login_mfa',
        loginMfaChallengeId: challengeId,
    });
    return { options, challenge: options.challenge };
}
export async function verifyLoginMfaWebAuthn(input, ipAddress, userAgent, clientDeviceType, requestId) {
    const state = webauthnChallengeCache.get(input.challenge);
    if (!state || state.type !== 'login_mfa' || !state.loginMfaChallengeId) {
        throw new AuthError('WebAuthn challenge expired', AuthErrorCodes.WEBAUTHN_CHALLENGE_INVALID, 400);
    }
    webauthnChallengeCache.delete(input.challenge);
    const loginChallenge = loginMfaChallengeCache.get(state.loginMfaChallengeId);
    if (!loginChallenge) {
        throw new AuthError('Login challenge expired', AuthErrorCodes.MFA_CHALLENGE_EXPIRED, 400);
    }
    const authResponse = input.response;
    const device = await repository.findWebAuthnDeviceByCredentialId(authResponse.id);
    if (!device || device.user_id !== loginChallenge.userId) {
        throw new AuthError('Unknown passkey', AuthErrorCodes.MFA_INVALID, 400);
    }
    const verification = await verifyAuthenticationResponse({
        response: authResponse,
        expectedChallenge: input.challenge,
        expectedOrigin: webauthnConfig.origin,
        expectedRPID: webauthnConfig.rpID,
        credential: credentialFromDevice(device),
        requireUserVerification: true,
    });
    if (!verification.verified) {
        loginChallenge.attempts += 1;
        loginMfaChallengeCache.set(state.loginMfaChallengeId, loginChallenge);
        throw new AuthError('Passkey verification failed', AuthErrorCodes.MFA_INVALID, 400);
    }
    loginMfaChallengeCache.delete(state.loginMfaChallengeId);
    await repository.updateWebAuthnSignCount(device.id, verification.authenticationInfo.newCounter, ipAddress);
    await repository.updateMFADeviceLastUsed(device.id, ipAddress);
    const user = await repository.findUserById(loginChallenge.userId);
    if (!user) {
        throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    await assertLoginAllowedByOrgPolicy(user);
    const session = await issueSessionForUser({
        user,
        ipAddress,
        userAgent,
        deviceName: loginChallenge.deviceName,
        deviceType: loginChallenge.clientDeviceType || clientDeviceType,
        mfaVerified: true,
        rememberMe: loginChallenge.rememberMe,
    });
    await repository.recordLogin(user.id, ipAddress, userAgent);
    logAudit({
        user_id: user.id,
        org_id: null,
        action: 'user.login',
        resource_type: 'user',
        resource_id: user.id,
        ip_address: ipAddress,
        user_agent: userAgent,
        request_id: requestId,
        metadata: { session_id: session.sessionId, mfa_required: true, webauthn: true },
    });
    return {
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
        expires_at: session.expiresAt,
        token_type: 'Bearer',
        session_id: session.sessionId,
        user_id: user.id,
    };
}
export async function createStepUpWebAuthnOptions(challengeId, userId) {
    const stepUp = stepUpChallengeCache.get(challengeId);
    if (!stepUp || stepUp.userId !== userId) {
        throw new AuthError('Step-up challenge expired', AuthErrorCodes.MFA_CHALLENGE_EXPIRED, 400);
    }
    const device = await repository.findMFADeviceById(stepUp.deviceId, userId);
    if (!device || device.device_type !== 'hardware_key' || !device.credential_id) {
        throw new AuthError('This step-up challenge requires a different MFA method', AuthErrorCodes.MFA_INVALID, 400);
    }
    const options = await generateAuthenticationOptions({
        rpID: webauthnConfig.rpID,
        userVerification: 'preferred',
        allowCredentials: [{ id: device.credential_id }],
    });
    webauthnChallengeCache.set(options.challenge, {
        userId,
        type: 'step_up',
        stepUpChallengeId: challengeId,
    });
    return { options, challenge: options.challenge };
}
export async function verifyStepUpWebAuthn(input, sessionId, userId, ipAddress) {
    const state = webauthnChallengeCache.get(input.challenge);
    if (!state ||
        state.type !== 'step_up' ||
        !state.stepUpChallengeId ||
        state.userId !== userId) {
        throw new AuthError('WebAuthn challenge expired', AuthErrorCodes.WEBAUTHN_CHALLENGE_INVALID, 400);
    }
    webauthnChallengeCache.delete(input.challenge);
    const stepUp = stepUpChallengeCache.get(state.stepUpChallengeId);
    if (!stepUp || stepUp.userId !== userId) {
        throw new AuthError('Step-up challenge expired', AuthErrorCodes.MFA_CHALLENGE_EXPIRED, 400);
    }
    const authResponse = input.response;
    const device = await repository.findWebAuthnDeviceByCredentialId(authResponse.id);
    if (!device || device.user_id !== userId || device.id !== stepUp.deviceId) {
        throw new AuthError('Unknown passkey', AuthErrorCodes.MFA_INVALID, 400);
    }
    const verification = await verifyAuthenticationResponse({
        response: authResponse,
        expectedChallenge: input.challenge,
        expectedOrigin: webauthnConfig.origin,
        expectedRPID: webauthnConfig.rpID,
        credential: credentialFromDevice(device),
        requireUserVerification: true,
    });
    if (!verification.verified) {
        stepUp.attempts += 1;
        stepUpChallengeCache.set(state.stepUpChallengeId, stepUp);
        throw new AuthError('Passkey verification failed', AuthErrorCodes.MFA_INVALID, 400);
    }
    stepUpChallengeCache.delete(state.stepUpChallengeId);
    await repository.updateWebAuthnSignCount(device.id, verification.authenticationInfo.newCounter, ipAddress);
    await repository.updateMFADeviceLastUsed(device.id, ipAddress);
    recordStepUpFreshness(sessionId);
    return { user_id: userId, mfa_verified: true };
}
//# sourceMappingURL=webauthn.service.js.map