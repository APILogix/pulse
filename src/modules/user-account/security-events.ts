import type { FastifyRequest } from 'fastify';

import { pool } from '../../config/database.js';

export type PersonalSecurityEventType =
  | 'login'
  | 'logout'
  | 'password_change'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'mfa_method_added'
  | 'mfa_method_removed'
  | 'backup_codes_regenerated'
  | 'device_trusted'
  | 'device_revoked'
  | 'session_revoked'
  | 'all_sessions_revoked'
  | 'profile_updated'
  | 'data_export_requested'
  | 'account_deletion_requested'
  | 'account_deletion_cancelled'
  | 'failed_login';

function getHeader(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : null;
}

export function getDeviceInfo(request: FastifyRequest): string | null {
  const ua = getHeader(request, 'user-agent');
  if (!ua) return null;

  const browser =
    ua.match(/Edg\/([\d.]+)/) ? 'Edge' :
    ua.match(/Chrome\/([\d.]+)/) ? 'Chrome' :
    ua.match(/Firefox\/([\d.]+)/) ? 'Firefox' :
    ua.match(/Version\/([\d.]+).*Safari/) ? 'Safari' :
    'Unknown browser';

  const os =
    ua.includes('Windows') ? 'Windows' :
    ua.includes('Mac OS X') ? 'macOS' :
    ua.includes('iPhone') || ua.includes('iPad') ? 'iOS' :
    ua.includes('Android') ? 'Android' :
    ua.includes('Linux') ? 'Linux' :
    'Unknown OS';

  return `${browser} / ${os}`;
}

export async function logSecurityEvent(
  userId: string,
  eventType: PersonalSecurityEventType,
  description: string,
  request?: FastifyRequest,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO user_security_events (
       user_id, event_type, description, device_info, ip_address, location, metadata
     ) VALUES ($1, $2, $3, $4, $5::inet, $6, $7::jsonb)`,
    [
      userId,
      eventType,
      description,
      request ? getDeviceInfo(request) : null,
      request?.ip ?? null,
      null,
      JSON.stringify(metadata),
    ],
  );
}
