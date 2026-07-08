/**
 * Auth repository — pure SQL access for the auth module.
 *
 * Conventions:
 *   - Every public function accepts an optional PoolClient so callers can
 *     compose multiple writes inside a single withTransaction block.
 *   - Functions never throw on "not found"; they return null/0/false so the
 *     service layer is the single owner of business-rule errors.
 *   - Sensitive bearer credentials (refresh tokens, email-flow tokens) are
 *     stored only as SHA-256 hashes; the plaintext is never persisted.
 */
import type { PoolClient } from 'pg';
export type SecurityEventType = 'brute_force_attempt' | 'suspicious_ip' | 'impossible_travel' | 'credential_stuffing' | 'account_takeover' | 'privilege_escalation' | 'mfa_disable_requested' | 'mfa_recovery_requested' | 'refresh_token_reuse';
export declare function recordSecurityEvent(data: {
    event_type: SecurityEventType;
    severity: number;
    user_id: string | null;
    ip_address: string;
    user_agent?: string | null;
    description: string;
    evidence?: Record<string, unknown>;
    action_taken?: string | null;
    blocked_until?: Date | null;
}, client?: PoolClient): Promise<void>;
//# sourceMappingURL=security-events.repository.d.ts.map