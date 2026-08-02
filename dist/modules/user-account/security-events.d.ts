import type { FastifyRequest } from 'fastify';
export type PersonalSecurityEventType = 'login' | 'logout' | 'password_change' | 'mfa_enabled' | 'mfa_disabled' | 'mfa_method_added' | 'mfa_method_removed' | 'backup_codes_regenerated' | 'device_trusted' | 'device_revoked' | 'session_revoked' | 'all_sessions_revoked' | 'profile_updated' | 'data_export_requested' | 'account_deletion_requested' | 'account_deletion_cancelled' | 'failed_login';
export declare function getDeviceInfo(request: FastifyRequest): string | null;
export declare function logSecurityEvent(userId: string, eventType: PersonalSecurityEventType, description: string, request?: FastifyRequest, metadata?: Record<string, unknown>): Promise<void>;
//# sourceMappingURL=security-events.d.ts.map