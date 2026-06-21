/**

 * Trusted devices — skip MFA on known fingerprints (Postgres + LRU-free).

 */

import { logAudit } from '../../shared/middleware/audit-logger.js';



import { TRUSTED_DEVICE_TTL_DAYS } from './constants.js';

import * as repository from './repository.js';

import { AuthError, AuthErrorCodes } from './types.js';

import { buildDeviceFingerprint } from './utils.js';



function trustedExpiresAt(): Date {

  return new Date(Date.now() + TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000);

}



export async function isLoginTrustedDevice(

  userId: string,

  ipAddress: string,

  userAgent: string,

): Promise<boolean> {

  const fingerprint = buildDeviceFingerprint(ipAddress, userAgent);

  return repository.isTrustedDevice(userId, fingerprint);

}



export async function trustCurrentDevice(

  userId: string,

  ipAddress: string,

  userAgent: string,

  deviceName: string | undefined,

  requestId: string,

): Promise<{ id: string; expires_at: Date }> {

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



export async function listTrustedDevices(userId: string) {

  const rows = await repository.listTrustedDevices(userId);

  return rows.map((r) => ({

    id: r.id,

    device_name: r.device_name,

    trusted_at: r.trusted_at,

    expires_at: r.expires_at,

    last_seen_at: r.last_seen_at,

  }));

}



export async function revokeTrustedDevice(

  userId: string,

  deviceId: string,

  ipAddress: string,

  requestId: string,

): Promise<void> {

  const ok = await repository.revokeTrustedDevice(userId, deviceId);

  if (!ok) {

    throw new AuthError(

      'Trusted device not found',

      AuthErrorCodes.VALIDATION_ERROR,

      404,

    );

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


