/**

 * Trusted devices — skip MFA on known fingerprints (Postgres + LRU-free).

 */
import { logAudit } from '../../../../shared/middleware/audit-logger.js';
import { TRUSTED_DEVICE_TTL_DAYS } from '../../domain/constants.js';
import * as repository from '../../infrastructure/repositories/index.js';
import { AuthError, AuthErrorCodes } from '../../domain/types.js';
import { buildDeviceFingerprint } from '../../infrastructure/crypto/hash.js';
function trustedExpiresAt() {
    return new Date(Date.now() + TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000);
}
export async function isLoginTrustedDevice(userId, ipAddress, userAgent) {
    const fingerprint = buildDeviceFingerprint(ipAddress, userAgent);
    return repository.isTrustedDevice(userId, fingerprint);
}
export async function trustCurrentDevice(userId, ipAddress, userAgent, deviceName, requestId) {
    const fingerprint = buildDeviceFingerprint(ipAddress, userAgent);
    const expiresAt = trustedExpiresAt();
    await repository.upsertTrustedDevice(userId, fingerprint, {
        ...(deviceName !== undefined ? { device_name: deviceName } : {}),
        ip_address: ipAddress,
        user_agent: userAgent,
        expires_at: expiresAt,
    });
    logAudit({
        user_id: userId,
        org_id: null,
        action: 'user.trusted_device_added',
        resource_type: 'trusted_device',
        resource_id: fingerprint,
        ip_address: ipAddress,
        user_agent: userAgent,
        request_id: requestId,
        metadata: { expires_at: expiresAt.toISOString() },
    });
    return { id: fingerprint, expires_at: expiresAt };
}
export async function listTrustedDevices(userId) {
    const rows = await repository.listTrustedDevices(userId);
    return rows.map((r) => ({
        id: r.id,
        device_name: r.device_name,
        trusted_at: r.trusted_at,
        expires_at: r.expires_at,
        last_seen_at: r.last_seen_at,
    }));
}
export async function revokeTrustedDevice(userId, deviceId, ipAddress, requestId) {
    const ok = await repository.revokeTrustedDevice(userId, deviceId);
    if (!ok) {
        throw new AuthError('Trusted device not found', AuthErrorCodes.VALIDATION_ERROR, 404);
    }
    logAudit({
        user_id: userId,
        org_id: null,
        action: 'user.trusted_device_revoked',
        resource_type: 'trusted_device',
        resource_id: deviceId,
        ip_address: ipAddress,
        request_id: requestId,
    });
}
//# sourceMappingURL=trusted-device.service.js.map