import bcrypt from 'bcrypt';
import { pgboss } from '../../lib/pgboss.js';
import * as repo from './repository.js';
import { logSecurityEvent } from './security-events.js';
export class UserAccountError extends Error {
    statusCode;
    code;
    details;
    constructor(message, statusCode = 400, code = 'USER_ACCOUNT_ERROR', details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}
const SUPPORTED_LOCALES = new Set(['en-US', 'en-GB', 'en-IN']);
function isValidTimeZone(timezone) {
    if (timezone === 'UTC')
        return true;
    try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
        return true;
    }
    catch {
        return false;
    }
}
function toProfile(user) {
    const locale = user.locale === 'en' ? 'en-US' : user.locale || 'en-US';
    return {
        id: user.id,
        display_name: user.display_name ?? user.full_name ?? user.email.split('@')[0],
        full_name: user.full_name,
        email: user.email,
        email_verified: Boolean(user.email_verified || user.email_verified_at),
        avatar_url: user.avatar_url,
        timezone: user.timezone || 'UTC',
        locale,
        preferences: {
            marketing_emails: user.marketing_emails ?? false,
            product_updates: user.product_updates ?? true,
        },
    };
}
async function requireUser(userId) {
    const user = await repo.getUserAccount(userId);
    if (!user) {
        throw new UserAccountError('User not found', 404, 'USER_NOT_FOUND');
    }
    return user;
}
function securityStatus(input) {
    const failed = [
        !input.emailVerified,
        !input.mfaEnabled,
        input.backupCodesRemaining <= 0,
    ].filter(Boolean).length;
    if (!input.emailVerified || (!input.mfaEnabled && input.backupCodesRemaining <= 0)) {
        return { status: 'critical', actions_needed: failed };
    }
    if (failed > 0)
        return { status: 'attention', actions_needed: failed };
    return { status: 'secure', actions_needed: 0 };
}
export async function getAccountOverview(userId) {
    const [user, mfaMethods, backupCodesRemaining, activeSessions, trustedDevices, passkeys, recentActivity,] = await Promise.all([
        requireUser(userId),
        repo.getVerifiedMfaDevices(userId),
        repo.countBackupCodes(userId),
        repo.countActiveSessions(userId),
        repo.countTrustedDevices(userId),
        repo.countPasskeys(userId),
        repo.getRecentActivity(userId),
    ]);
    const emailVerified = Boolean(user.email_verified || user.email_verified_at);
    const mfaEnabled = mfaMethods.length > 0 || user.mfa_enabled;
    const health = securityStatus({ emailVerified, mfaEnabled, backupCodesRemaining });
    return {
        user: {
            ...toProfile(user),
            preferences: undefined,
        },
        security_health: {
            ...health,
            checks: {
                email_verified: emailVerified,
                mfa_enabled: mfaEnabled,
                backup_codes_remaining: backupCodesRemaining,
                has_trusted_devices: trustedDevices > 0,
                has_recovery_method: backupCodesRemaining > 0,
            },
        },
        mfa_summary: {
            enabled: mfaEnabled,
            methods: mfaMethods.map((m) => ({
                method: m.method,
                name: m.name,
                is_default: m.is_default,
            })),
        },
        sessions: { active_count: activeSessions },
        backup_codes: { remaining: backupCodesRemaining },
        trusted_devices: { count: trustedDevices },
        passkeys: { count: passkeys },
        recent_activity: recentActivity,
    };
}
export async function getProfile(userId) {
    return toProfile(await requireUser(userId));
}
export async function updateProfile(userId, input, request) {
    const displayName = input.display_name.trim();
    const fullName = input.full_name?.trim() || null;
    const avatarUrl = input.avatar_url?.trim() || null;
    if (!displayName || displayName.length > 100) {
        throw new UserAccountError('Display name must be 1-100 characters', 400, 'VALIDATION_ERROR');
    }
    if (fullName && fullName.length > 255) {
        throw new UserAccountError('Full name must be 1-255 characters', 400, 'VALIDATION_ERROR');
    }
    if (avatarUrl) {
        try {
            new URL(avatarUrl);
        }
        catch {
            throw new UserAccountError('Avatar URL must be a valid URL', 400, 'VALIDATION_ERROR');
        }
    }
    if (!isValidTimeZone(input.timezone)) {
        throw new UserAccountError('Timezone must be a valid IANA timezone', 400, 'VALIDATION_ERROR');
    }
    if (!SUPPORTED_LOCALES.has(input.locale)) {
        throw new UserAccountError('Locale is not supported', 400, 'VALIDATION_ERROR');
    }
    const updated = await repo.updateUserProfile(userId, {
        display_name: displayName,
        full_name: fullName,
        avatar_url: avatarUrl,
        timezone: input.timezone,
        locale: input.locale,
        marketing_emails: input.marketing_emails,
        product_updates: input.product_updates,
    });
    if (!updated)
        throw new UserAccountError('User not found', 404, 'USER_NOT_FOUND');
    await logSecurityEvent(userId, 'profile_updated', 'Profile updated', request);
    return toProfile(updated);
}
export async function deleteAvatar(userId, request) {
    const updated = await repo.removeAvatar(userId);
    if (!updated)
        throw new UserAccountError('User not found', 404, 'USER_NOT_FOUND');
    await logSecurityEvent(userId, 'profile_updated', 'Profile avatar removed', request);
    return toProfile(updated);
}
async function verifyPassword(user, password) {
    if (!user.password_hash)
        return;
    if (!password) {
        throw new UserAccountError('Password required', 400, 'PASSWORD_REQUIRED');
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
        throw new UserAccountError('Password incorrect', 401, 'PASSWORD_INCORRECT');
    }
}
function requireMfaIfEnabled(user, mfaCode) {
    if (user.mfa_enabled && !mfaCode) {
        throw new UserAccountError('MFA code required', 400, 'MFA_REQUIRED');
    }
}
export async function requestDataExport(userId, input, request) {
    const user = await requireUser(userId);
    await verifyPassword(user, input.password);
    requireMfaIfEnabled(user, input.mfa_code);
    const jobId = await pgboss.send('user-data-export', { user_id: userId });
    await logSecurityEvent(userId, 'data_export_requested', 'Account data export requested', request, { job_id: jobId });
    return { job_id: String(jobId), status: 'queued', estimated_minutes: 5 };
}
export async function scheduleDeletion(userId, input, request) {
    const user = await requireUser(userId);
    await verifyPassword(user, input.password);
    requireMfaIfEnabled(user, input.mfa_code);
    if (input.confirmation_text !== user.email) {
        throw new UserAccountError('Confirmation text must match your email address', 400, 'CONFIRMATION_MISMATCH');
    }
    const scheduled = await repo.scheduleAccountDeletion(userId);
    if (!scheduled)
        throw new UserAccountError('User not found', 404, 'USER_NOT_FOUND');
    await logSecurityEvent(userId, 'account_deletion_requested', 'Account deletion requested', request);
    const permanentDate = scheduled.deleted_at.toISOString().slice(0, 10);
    return {
        message: `Account deletion scheduled. Your account will be permanently deleted on ${permanentDate}.`,
        grace_period_days: 30,
        cancel_url: '/api/v1/user/account/cancel-deletion',
    };
}
export async function cancelDeletion(userId, request) {
    await repo.cancelAccountDeletion(userId);
    await logSecurityEvent(userId, 'account_deletion_cancelled', 'Account deletion cancelled', request);
    return { message: 'Account deletion cancelled.' };
}
export async function signOutAllOtherDevices(userId, currentSessionId, request) {
    const revoked = await repo.revokeAllOtherSessions(userId, currentSessionId);
    await logSecurityEvent(userId, 'all_sessions_revoked', 'All other sessions signed out', request, { revoked });
    return { revoked };
}
export async function buildUserDataExport(userId) {
    return repo.getUserDataExport(userId);
}
//# sourceMappingURL=service.js.map