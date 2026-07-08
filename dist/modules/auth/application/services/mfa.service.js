import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { env as config } from '../../../../config/env.js';
import { logger } from '../../../../config/logger.js';
import { logAudit } from '../../../../shared/middleware/audit-logger.js';
import { encrypt, verifyPassword, } from '../../../../shared/utils/encryption.js';
import { generateId } from '../../../../shared/utils/id.js';
import { mfaBackupTempCache, recordStepUpFreshness, stepUpChallengeCache, } from '../../infrastructure/cache/auth.cache.js';
import { assertMfaEnrollmentAllowed, } from '../../domain/policies.js';
import * as repository from '../../infrastructure/repositories/index.js';
import { AuthError, AuthErrorCodes, } from '../../domain/types.js';
import { MFA_DISABLE_TOKEN_TTL_SECONDS, normalizeEmail, PASSWORD_RESET_TTL_SECONDS, STEP_UP_CHALLENGE_TTL_SECONDS } from '../../domain/constants.js';
import { generateEmailFlowToken, hashEmailFlowToken } from '../../infrastructure/crypto/hash.js';
import { sendMFAStatusEmail, sendMfaDisableConfirmEmail, sendPasswordResetEmail, generateEmailMfaOtp, hashEmailMfaOtp, createEmailMfaOtp, consumeEmailMfaOtp, sendEmailMfaOtpEmail } from './email.service.js';
import { assertUserUsable, buildMfaDisplayHint, verifyTotpDeviceCode, generateBackupCodes, buildTotp, markAllUserTokensRevoked } from './shared-helpers.js';
export async function setupMFA(userId, input, ipAddress) {
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    assertUserUsable(user);
    // Enforce organization MFA policy (allowed methods + per-user device cap)
    // before enrolling. Re-enrolling an existing device of the same type reuses
    // its row, so it does not count against the cap.
    const policyDevices = await repository.findMFADevicesByUserId(userId);
    const existingOfType = policyDevices.find((d) => d.device_type === input.type && d.is_active);
    const activeCountForCap = policyDevices.filter((d) => d.is_active && d.id !== existingOfType?.id).length;
    await assertMfaEnrollmentAllowed(userId, input.type, activeCountForCap);
    // ΓöÇΓöÇ Email MFA setup ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    if (input.type === 'email') {
        const existing = await repository.findAnyMFADeviceByType(userId, 'email');
        if (existing && existing.is_active && existing.verified) {
            throw new AuthError('Email MFA is already configured. Disable it first if you want to re-enroll.', AuthErrorCodes.MFA_ALREADY_ENABLED, 409);
        }
        // A new device becomes primary only when the user has no other device
        // currently flagged primary+active. This mirrors the DB partial unique
        // index `one_primary_mfa (is_primary AND is_active)` exactly, so the
        // INSERT/UPDATE can never violate it. Re-enrolling a device that was
        // itself the primary keeps it primary.
        const allDevices = await repository.findMFADevicesByUserId(userId);
        const hasOtherPrimary = allDevices.some((d) => d.is_primary && d.is_active && d.id !== existing?.id);
        const isPrimary = existing?.is_primary === true || !hasOtherPrimary;
        let device;
        if (existing) {
            const reset = await repository.resetMFADeviceForReSetup(existing.id, {
                device_name: input.device_name,
                secret_encrypted: null, // email MFA has no stored secret
                is_primary: isPrimary,
                device_metadata: {
                    setup_ip: ipAddress,
                    re_enrolled_at: new Date().toISOString(),
                },
            });
            if (!reset) {
                throw new AuthError('Failed to reset MFA device', AuthErrorCodes.MFA_DEVICE_NOT_FOUND, 500);
            }
            device = reset;
        }
        else {
            device = await repository.createMFADevice({
                user_id: userId,
                device_type: 'email',
                device_name: input.device_name,
                secret_encrypted: null,
                is_primary: isPrimary,
                device_metadata: { setup_ip: ipAddress },
                display_hint: buildMfaDisplayHint('email', input.device_name, {
                    email: user.email,
                }),
            });
        }
        // Generate and send a setup OTP to confirm the user controls this email.
        const otp = await generateEmailMfaOtp();
        const otpHash = hashEmailMfaOtp(otp);
        await createEmailMfaOtp(userId, device.id, otpHash);
        await sendEmailMfaOtpEmail(user, otp, input.device_name, 'setup');
        const { plain: backupCodes, hashed } = await generateBackupCodes();
        mfaBackupTempCache.set(device.id, hashed);
        return {
            device_id: device.id,
            device_type: 'email',
            backupCodes,
        };
    }
    // ΓöÇΓöÇ TOTP setup ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // Look at any existing TOTP device so we can reactivate it.
    const existing = await repository.findAnyMFADeviceByType(userId, 'totp');
    if (existing && existing.is_active && existing.verified) {
        throw new AuthError('TOTP MFA is already configured. Disable it first if you want to re-enroll.', AuthErrorCodes.MFA_ALREADY_ENABLED, 409);
    }
    const secret = new OTPAuth.Secret({ size: 32 });
    const totp = buildTotp(secret.base32, user.email);
    const secretEncrypted = encrypt(secret.base32, config.ENCRYPTION_KEY);
    // A new device becomes primary only when the user has no other verified
    // active device. Re-enrolling a device that was already primary keeps it
    // primary. Adding TOTP alongside an existing primary must not demote it.
    const allTotpDevices = await repository.findMFADevicesByUserId(userId);
    const hasOtherPrimaryTotp = allTotpDevices.some((d) => d.is_primary && d.is_active && d.id !== existing?.id);
    const isPrimary = existing?.is_primary === true || !hasOtherPrimaryTotp;
    let device;
    if (existing) {
        const reset = await repository.resetMFADeviceForReSetup(existing.id, {
            device_name: input.device_name,
            secret_encrypted: secretEncrypted,
            is_primary: isPrimary,
            device_metadata: {
                setup_ip: ipAddress,
                re_enrolled_at: new Date().toISOString(),
            },
        });
        if (!reset) {
            throw new AuthError('Failed to reset MFA device', AuthErrorCodes.MFA_DEVICE_NOT_FOUND, 500);
        }
        device = reset;
    }
    else {
        device = await repository.createMFADevice({
            user_id: userId,
            device_type: 'totp',
            device_name: input.device_name,
            secret_encrypted: secretEncrypted,
            is_primary: isPrimary,
            device_metadata: { setup_ip: ipAddress },
            display_hint: buildMfaDisplayHint('totp', input.device_name),
        });
    }
    const { plain: backupCodes, hashed } = await generateBackupCodes();
    // Hold backup-code hashes in process until verify-setup commits them. The
    // LRU TTL (24h) is generous enough that "I'll set this up later today" is
    // safe; abandoned setups expire on their own.
    mfaBackupTempCache.set(device.id, hashed);
    const qrCodeUrl = await QRCode.toDataURL(totp.toString());
    return {
        device_id: device.id,
        device_type: 'totp',
        secret: secret.base32,
        qrCodeUrl,
        backupCodes,
    };
}
export async function verifyMFASetup(userId, input, ipAddress, requestId) {
    const device = await repository.findMFADeviceById(input.device_id, userId);
    if (!device) {
        throw new AuthError('MFA device not found', AuthErrorCodes.MFA_DEVICE_NOT_FOUND, 404);
    }
    if (device.verified && device.is_active) {
        throw new AuthError('Device already verified', AuthErrorCodes.MFA_ALREADY_ENABLED, 409);
    }
    // Verify the code based on device type.
    if (device.device_type === 'email') {
        const codeHash = hashEmailMfaOtp(input.code);
        const ok = await consumeEmailMfaOtp(device.id, codeHash);
        if (!ok) {
            throw new AuthError('Invalid or expired verification code', AuthErrorCodes.MFA_INVALID, 400);
        }
    }
    else {
        // TOTP
        if (!device.secret_encrypted) {
            throw new AuthError('Device has no secret to verify', AuthErrorCodes.MFA_INVALID, 400);
        }
        if (!verifyTotpDeviceCode(device, input.code)) {
            throw new AuthError('Invalid verification code', AuthErrorCodes.MFA_INVALID, 400);
        }
    }
    const backupCodesHash = mfaBackupTempCache.get(device.id) ?? [];
    await repository.withTransaction(async (client) => {
        await repository.verifyMFADevice(device.id, backupCodesHash, client);
        if (device.is_primary) {
            await repository.updateMFADevicePrimary(userId, device.id, client);
        }
        await repository.updateUserMFAEnabled(userId, true, client);
        await repository.updateBackupCodesGenerated(userId, client);
    });
    mfaBackupTempCache.delete(device.id);
    const user = await repository.findUserById(userId);
    if (user)
        await sendMFAStatusEmail(user, true);
    logAudit({
        user_id: userId,
        org_id: null,
        action: 'user.mfa_enabled',
        resource_type: 'user',
        resource_id: userId,
        ip_address: ipAddress,
        request_id: requestId,
        metadata: { device_id: device.id, device_type: device.device_type },
    });
}
export async function createMFAChallenge(userId) {
    const devices = await repository.findMFADevicesByUserId(userId);
    const verified = devices.filter((d) => d.verified && d.is_active);
    if (verified.length === 0) {
        throw new AuthError('No verified MFA devices', AuthErrorCodes.MFA_NOT_ENABLED, 400);
    }
    const primary = verified.find((d) => d.is_primary) || verified[0];
    // For email MFA, generate and send an OTP before issuing the challenge.
    if (primary.device_type === 'email') {
        const user = await repository.findUserById(userId);
        if (user) {
            const otp = await generateEmailMfaOtp();
            const otpHash = hashEmailMfaOtp(otp);
            await createEmailMfaOtp(userId, primary.id, otpHash);
            await sendEmailMfaOtpEmail(user, otp, primary.device_name, 'challenge');
        }
    }
    const challengeId = generateId();
    const challenge = {
        userId,
        deviceId: primary.id,
        attempts: 0,
    };
    stepUpChallengeCache.set(challengeId, challenge);
    return {
        challengeId,
        deviceId: primary.id,
        deviceType: primary.device_type,
        expiresAt: new Date(Date.now() + STEP_UP_CHALLENGE_TTL_SECONDS * 1000),
    };
}
/**
 * Verify a step-up MFA challenge. On success, stamp step-up freshness on the
 * caller's session in the LRU. Sensitive routes (`requireStepUp`) check that
 * stamp.
 */
export async function verifyMFAChallenge(challengeId, input, sessionId, ipAddress) {
    const challenge = stepUpChallengeCache.get(challengeId);
    if (!challenge) {
        throw new AuthError('Challenge expired or invalid', AuthErrorCodes.MFA_CHALLENGE_EXPIRED, 400);
    }
    if (challenge.attempts >= 3) {
        stepUpChallengeCache.delete(challengeId);
        throw new AuthError('Too many failed attempts', AuthErrorCodes.MFA_INVALID, 400);
    }
    const device = await repository.findMFADeviceById(challenge.deviceId, challenge.userId);
    if (!device || !device.verified || !device.is_active) {
        stepUpChallengeCache.delete(challengeId);
        throw new AuthError('MFA device invalid', AuthErrorCodes.MFA_INVALID, 400);
    }
    // Verify the code based on device type.
    let stepUpVerified = false;
    if (device.device_type === 'hardware_key') {
        throw new AuthError('Use POST /auth/mfa/step-up/webauthn/options and /verify for passkey step-up', AuthErrorCodes.MFA_INVALID, 400, { device_type: 'hardware_key' });
    }
    if (device.device_type === 'email') {
        const codeHash = hashEmailMfaOtp(input.code);
        stepUpVerified = await consumeEmailMfaOtp(device.id, codeHash);
    }
    else {
        stepUpVerified = verifyTotpDeviceCode(device, input.code);
    }
    if (!stepUpVerified) {
        challenge.attempts += 1;
        stepUpChallengeCache.set(challengeId, challenge);
        throw new AuthError('Invalid code', AuthErrorCodes.MFA_INVALID, 400);
    }
    stepUpChallengeCache.delete(challengeId);
    await repository.updateMFADeviceLastUsed(device.id, ipAddress);
    // Stamp step-up freshness on this session so subsequent sensitive
    // endpoints (`requireStepUp`) accept the call.
    recordStepUpFreshness(sessionId);
    return { userId: challenge.userId, deviceId: device.id };
}
export async function listMFADevices(userId) {
    return repository.findMFADevicesByUserId(userId, true);
}
export async function renameMFADevice(userId, deviceId, input) {
    const updated = await repository.updateMFADeviceName(deviceId, userId, input.device_name);
    if (!updated) {
        throw new AuthError('MFA device not found', AuthErrorCodes.MFA_DEVICE_NOT_FOUND, 404);
    }
}
/**
 * Admin-initiated password reset email. Revokes all active sessions first.
 */
export async function adminForcePasswordReset(targetUserId, adminId, isAdmin, input, ipAddress, requestId) {
    if (!isAdmin) {
        throw new AuthError('Admin access required', AuthErrorCodes.INSUFFICIENT_PERMISSIONS, 403);
    }
    if (targetUserId === adminId) {
        throw new AuthError('Use change-password for your own account', AuthErrorCodes.INVALID_OPERATION, 400);
    }
    const user = await repository.findUserById(targetUserId);
    if (!user || user.deleted_at) {
        throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    await repository.withTransaction(async (client) => {
        await client.query(`UPDATE user_sessions
         SET status = 'terminated_by_admin',
             terminated_at = NOW(),
             terminated_by = $2,
             termination_reason = $3
       WHERE user_id = $1 AND status = 'active'`, [
            targetUserId,
            adminId,
            input.reason
                ? `Admin password reset: ${input.reason}`
                : 'Admin password reset',
        ]);
    });
    markAllUserTokensRevoked(targetUserId);
    const resetToken = generateEmailFlowToken();
    const resetTokenHash = hashEmailFlowToken('password_reset', resetToken);
    await repository.createEmailVerification({
        user_id: user.id,
        email: normalizeEmail(user.email),
        token_hash: resetTokenHash,
        purpose: 'password_reset',
        expires_at: new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000),
    });
    await sendPasswordResetEmail(user, resetToken);
    logAudit({
        user_id: adminId,
        org_id: null,
        action: 'user.admin_password_reset',
        resource_type: 'user',
        resource_id: targetUserId,
        ip_address: ipAddress,
        request_id: requestId,
        metadata: { reason: input.reason ?? null },
    });
    return {
        message: 'Password reset email sent and all sessions revoked for this user.',
    };
}
/**
 * Resend an email MFA OTP for a given device. Used during setup (to resend
 * the setup confirmation code) and during step-up challenges.
 */
export async function resendEmailMfaOtp(userId, deviceId) {
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    assertUserUsable(user);
    const device = await repository.findMFADeviceById(deviceId, userId);
    if (!device || !device.is_active) {
        throw new AuthError('MFA device not found', AuthErrorCodes.MFA_DEVICE_NOT_FOUND, 404);
    }
    if (device.device_type !== 'email') {
        throw new AuthError('Device is not an email MFA device', AuthErrorCodes.INVALID_OPERATION, 400);
    }
    const otp = await generateEmailMfaOtp();
    const otpHash = hashEmailMfaOtp(otp);
    await createEmailMfaOtp(userId, device.id, otpHash);
    const purpose = device.verified ? 'challenge' : 'setup';
    await sendEmailMfaOtpEmail(user, otp, device.device_name, purpose);
}
export async function setPrimaryMFADevice(userId, deviceId) {
    const device = await repository.findMFADeviceById(deviceId, userId);
    if (!device || !device.verified || !device.is_active) {
        throw new AuthError('Invalid device', AuthErrorCodes.MFA_DEVICE_NOT_FOUND, 400);
    }
    await repository.updateMFADevicePrimary(userId, deviceId);
}
/**
 * Remove an MFA device.
 *
 * If this is the LAST verified+active device, we require the current
 * password AND step-up freshness on the session (`routes.ts` enforces step-up
 * via the route middleware). We never accept a TOTP from the device being
 * removed.
 *
 * If other devices remain, step-up freshness is still required by the route
 * but no password is needed; the user has already proven recent MFA via the
 * step-up challenge.
 */
export async function removeMFADevice(userId, deviceId, currentPassword, ipAddress, requestId) {
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    const devices = await repository.findMFADevicesByUserId(userId);
    const target = devices.find((d) => d.id === deviceId);
    if (!target) {
        throw new AuthError('Device not found', AuthErrorCodes.MFA_DEVICE_NOT_FOUND, 404);
    }
    const remainingActive = devices.filter((d) => d.verified && d.is_active && d.id !== deviceId);
    if (remainingActive.length === 0) {
        if (!user.password_hash) {
            throw new AuthError('Cannot remove last MFA device on a passwordless account; contact support', AuthErrorCodes.INVALID_OPERATION, 400);
        }
        if (!currentPassword) {
            throw new AuthError('Current password required to remove the last MFA device', AuthErrorCodes.PASSWORD_REQUIRED, 400);
        }
        const valid = await verifyPassword(currentPassword, user.password_hash);
        if (!valid) {
            throw new AuthError('Password incorrect', AuthErrorCodes.PASSWORD_INCORRECT, 401);
        }
    }
    await repository.withTransaction(async (client) => {
        // Re-fetch inside transaction to close TOCTOU on device count/state.
        const freshDevices = await repository.findMFADevicesByUserId(userId);
        const freshTarget = freshDevices.find((d) => d.id === deviceId);
        if (!freshTarget) {
            throw new AuthError('Device not found', AuthErrorCodes.MFA_DEVICE_NOT_FOUND, 404);
        }
        const freshRemaining = freshDevices.filter((d) => d.verified && d.is_active && d.id !== deviceId);
        await repository.disableMFADevice(deviceId, 'user_removed', client);
        if (freshRemaining.length === 0) {
            await repository.updateUserMFAEnabled(userId, false, client);
        }
        else if (freshTarget.is_primary) {
            const newPrimary = freshRemaining[0];
            await repository.updateMFADevicePrimary(userId, newPrimary.id, client);
        }
    });
    if (remainingActive.length === 0) {
        await sendMFAStatusEmail(user, false);
    }
    logAudit({
        user_id: userId,
        org_id: null,
        action: remainingActive.length === 0
            ? 'user.mfa_disabled'
            : 'user.mfa_device_removed',
        resource_type: 'user',
        resource_id: userId,
        ip_address: ipAddress,
        request_id: requestId,
        metadata: { device_id: deviceId, last_device: remainingActive.length === 0 },
    });
}
export async function generateNewBackupCodes(userId, input) {
    const devices = await repository.findMFADevicesByUserId(userId);
    const primary = devices.find((d) => d.is_primary && d.verified && d.is_active);
    if (!primary) {
        throw new AuthError('No primary MFA device', AuthErrorCodes.MFA_NOT_ENABLED, 400);
    }
    // Verify the code based on device type.
    let codeValid = false;
    if (primary.device_type === 'email') {
        const codeHash = hashEmailMfaOtp(input.mfa_code ?? '');
        codeValid = await consumeEmailMfaOtp(primary.id, codeHash);
    }
    else {
        codeValid = verifyTotpDeviceCode(primary, input.mfa_code ?? '');
    }
    if (!codeValid) {
        throw new AuthError('Invalid MFA code', AuthErrorCodes.MFA_INVALID, 400);
    }
    const { plain, hashed } = await generateBackupCodes();
    await repository.withTransaction(async (client) => {
        await repository.setBackupCodesForAllUserDevices(userId, hashed, client);
        await repository.updateBackupCodesGenerated(userId, client);
    });
    return plain;
}
/**
 * Toggle MFA. Enabling requires possession of an already-verified device +
 * a fresh TOTP code. Disabling now goes through the two-step
 * `requestMfaDisable` / `confirmMfaDisable` flow and is rejected here.
 */
export async function toggleMFA(userId, input, ipAddress, requestId) {
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    assertUserUsable(user);
    if (input.enabled && user.mfa_enabled)
        return { enabled: true };
    // Enabling: require a currently-verified device.
    const devices = await repository.findMFADevicesByUserId(userId);
    const primary = devices.find((d) => d.is_primary && d.verified && d.is_active) ||
        devices.find((d) => d.verified && d.is_active);
    if (!primary) {
        throw new AuthError('Verified MFA device required before enabling MFA', AuthErrorCodes.MFA_NOT_ENABLED, 400);
    }
    // Verify the code based on device type.
    let codeValid = false;
    if (primary.device_type === 'email') {
        const codeHash = hashEmailMfaOtp(input.mfa_code ?? '');
        codeValid = await consumeEmailMfaOtp(primary.id, codeHash);
    }
    else {
        codeValid = verifyTotpDeviceCode(primary, input.mfa_code ?? '');
    }
    if (!codeValid) {
        throw new AuthError('Invalid MFA code', AuthErrorCodes.MFA_INVALID, 400);
    }
    await repository.updateUserMFAEnabled(userId, true);
    await sendMFAStatusEmail(user, true);
    logAudit({
        user_id: userId,
        org_id: null,
        action: 'user.mfa_enabled',
        resource_type: 'user',
        resource_id: userId,
        ip_address: ipAddress,
        request_id: requestId,
        metadata: { reason: 'user_toggled' },
    });
    return { enabled: true };
}
/**
 * Step 1 of MFA disable: verify the supplied TOTP, then mail the user a
 * one-time confirmation link. MFA stays enabled until the link is consumed.
 *
 * This prevents the "phished password + one TOTP = MFA disabled" attack:
 * even if both are phished in real time, the attacker still needs control
 * of the user's email inbox.
 */
export async function requestMfaDisable(userId, input, ipAddress, requestId) {
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    if (!user.mfa_enabled) {
        throw new AuthError('MFA not enabled', AuthErrorCodes.MFA_NOT_ENABLED, 400);
    }
    const devices = await repository.findMFADevicesByUserId(userId);
    const primary = devices.find((d) => d.is_primary && d.verified && d.is_active);
    if (!primary) {
        throw new AuthError('MFA not enabled', AuthErrorCodes.MFA_NOT_ENABLED, 400);
    }
    // Accept TOTP or email OTP at this stage. Backup codes intentionally cannot
    // start a disable request, because a single phished backup code should not
    // be the entire trust signal for tearing down MFA.
    let codeValid = false;
    if (primary.device_type === 'email') {
        const codeHash = hashEmailMfaOtp(input.mfa_code ?? '');
        codeValid = await consumeEmailMfaOtp(primary.id, codeHash);
    }
    else {
        codeValid = verifyTotpDeviceCode(primary, input.mfa_code ?? '');
    }
    if (!codeValid) {
        throw new AuthError('Invalid MFA code', AuthErrorCodes.MFA_INVALID, 400);
    }
    const token = generateEmailFlowToken();
    await repository.createEmailVerification({
        user_id: user.id,
        email: normalizeEmail(user.email),
        token_hash: hashEmailFlowToken('mfa_disable', token),
        purpose: 'mfa_disable',
        expires_at: new Date(Date.now() + MFA_DISABLE_TOKEN_TTL_SECONDS * 1000),
    });
    await sendMfaDisableConfirmEmail(user, token);
    await repository
        .recordSecurityEvent({
        event_type: 'mfa_disable_requested',
        severity: 5,
        user_id: user.id,
        ip_address: ipAddress,
        description: 'User requested MFA disable; awaiting email confirmation',
    })
        .catch((err) => {
        logger.warn({ err, userId: user.id }, 'recordSecurityEvent failed');
    });
    logAudit({
        user_id: userId,
        org_id: null,
        action: 'user.mfa_disable_requested',
        resource_type: 'user',
        resource_id: userId,
        ip_address: ipAddress,
        request_id: requestId,
    });
    return {
        message: 'Confirmation email sent. Click the link in the email to complete MFA disable.',
    };
}
/**
 * Step 2 of MFA disable: consume the one-time email token and actually
 * disable MFA. The token can only be redeemed once; old tokens for the same
 * user/purpose are invalidated when a new request is made.
 */
export async function confirmMfaDisable(input, ipAddress, requestId) {
    const tokenHash = hashEmailFlowToken('mfa_disable', input.token);
    let userId = null;
    await repository.withTransaction(async (client) => {
        const consumed = await repository.consumeEmailVerificationToken(tokenHash, 'mfa_disable', client);
        if (!consumed) {
            throw new AuthError('Invalid or expired MFA disable token', AuthErrorCodes.MFA_DISABLE_INVALID, 400);
        }
        const userRes = await client.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [consumed.user_id]);
        const user = userRes.rows[0];
        if (!user ||
            user.status !== 'active' ||
            normalizeEmail(user.email) !== normalizeEmail(consumed.email)) {
            throw new AuthError('Invalid or expired MFA disable token', AuthErrorCodes.MFA_DISABLE_INVALID, 400);
        }
        if (!user.mfa_enabled) {
            // Token was valid but MFA already off ΓÇö treat as idempotent success.
            userId = user.id;
            return;
        }
        await repository.disableAllMFADevices(user.id, 'User disabled MFA', client);
        await repository.revokeAllTrustedDevices(user.id, 'MFA disabled', client);
        await repository.updateUserMFAEnabled(user.id, false, client);
        userId = user.id;
    });
    if (userId) {
        const user = await repository.findUserById(userId);
        if (user)
            await sendMFAStatusEmail(user, false);
        logAudit({
            user_id: userId,
            org_id: null,
            action: 'user.mfa_disabled',
            resource_type: 'user',
            resource_id: userId,
            ip_address: ipAddress,
            request_id: requestId,
            metadata: { method: 'email_confirmation' },
        });
    }
}
/**
 * Single-step MFA disable. The route requires fresh step-up, so this function
 * only checks account/device state and performs the teardown transaction.
 */
export async function disableMFA(userId, _input, ipAddress, requestId) {
    const user = await repository.findUserById(userId);
    if (!user) {
        throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    assertUserUsable(user);
    if (!user.mfa_enabled) {
        throw new AuthError('MFA not enabled', AuthErrorCodes.MFA_NOT_ENABLED, 400);
    }
    const devices = await repository.findMFADevicesByUserId(userId);
    const verifiedActive = devices.filter((d) => d.verified && d.is_active);
    if (verifiedActive.length === 0) {
        throw new AuthError('MFA not enabled', AuthErrorCodes.MFA_NOT_ENABLED, 400);
    }
    await repository.withTransaction(async (client) => {
        await repository.disableAllMFADevices(user.id, 'User disabled MFA', client);
        await repository.revokeAllTrustedDevices(user.id, 'MFA disabled', client);
        await repository.updateUserMFAEnabled(user.id, false, client);
    });
    await sendMFAStatusEmail(user, false);
    await repository
        .recordSecurityEvent({
        event_type: 'mfa_disable_requested',
        severity: 5,
        user_id: user.id,
        ip_address: ipAddress,
        description: 'User disabled MFA after step-up verification',
    })
        .catch((err) => {
        logger.warn({ err, userId: user.id }, 'recordSecurityEvent failed');
    });
    logAudit({
        user_id: userId,
        org_id: null,
        action: 'user.mfa_disabled',
        resource_type: 'user',
        resource_id: userId,
        ip_address: ipAddress,
        request_id: requestId,
        metadata: { method: 'step_up' },
    });
    return { mfa_enabled: false };
}
// ============================================================================
// SESSIONS
// ============================================================================
//# sourceMappingURL=mfa.service.js.map