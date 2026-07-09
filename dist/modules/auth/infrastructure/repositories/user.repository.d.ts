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
import type { User, UserStatus } from '../../domain/types.js';
export declare function findUserById(id: string, client?: PoolClient): Promise<User | null>;
export declare function findUserByEmailHash(emailHash: string, client?: PoolClient): Promise<User | null>;
/**
 * Find a user even when soft-deleted. Used by admin restore flows.
 */
export declare function findUserByIdIncludingDeleted(id: string, client?: PoolClient): Promise<User | null>;
export declare function createUser(data: {
    id: string;
    email: string;
    full_name: string;
    avatar_url?: string | null;
    password?: string | null;
    accepted_terms_version?: string | null;
    accepted_privacy_version?: string | null;
    marketing_consent?: boolean;
}, client?: PoolClient): Promise<User>;
export declare function updateUser(id: string, requestingUserId: string, data: Partial<Pick<User, 'full_name' | 'avatar_url' | 'timezone' | 'locale' | 'preferred_mfa_method'>>, client?: PoolClient): Promise<User | null>;
export declare function softDeleteUser(id: string, reason: string | null, deletedBy: string | null, client?: PoolClient): Promise<boolean>;
export declare function restoreUser(id: string, client?: PoolClient): Promise<User | null>;
/**
 * Suspend a user. Records the suspending admin in dedicated columns so
 * `deleted_by` / `deleted_at` remain exclusively for soft-delete semantics.
 */
export declare function suspendUser(id: string, reason: string, suspendedBy: string, client?: PoolClient): Promise<User | null>;
/**
 * Restore a suspended user to active status. Does not revive soft-deleted users.
 */
export declare function unsuspendUser(id: string, client?: PoolClient): Promise<User | null>;
/**
 * Admin-initiated account lock (distinct from brute-force lockout).
 * Sets `locked_until` far in the future until explicitly unlocked.
 */
export declare function adminLockUser(id: string, reason: string, lockedBy: string, client?: PoolClient): Promise<User | null>;
/**
 * Clear admin/brute-force lock state and failed-login counters.
 */
export declare function adminUnlockUser(id: string, client?: PoolClient): Promise<User | null>;
/**
 * Cursor-paginated user list for the admin endpoint. Cursor is a tuple of
 * (created_at, id) so it is stable when many rows share a created_at.
 */
export interface ListUsersOptions {
    status?: UserStatus;
    limit?: number;
    offset?: number;
    search?: string;
}
export declare function listUsers(options: ListUsersOptions, client?: PoolClient): Promise<{
    users: User[];
    total: number;
}>;
/**
 * Atomic failed-login update.
 *
 * Increments `login_attempts` in the database itself so concurrent failed
 * attempts cannot race and produce an under-counted value. The lockout
 * schedule is encoded as a SQL CASE that mirrors `lockoutDurationSeconds()`
 * in utils.ts, which keeps the application and database in agreement.
 *
 * Returns the resulting `(login_attempts, locked_until)` so the service can
 * decide whether to emit a `security_events` row for the lockout.
 */
export declare function recordFailedLogin(id: string, ip: string, client?: PoolClient): Promise<{
    login_attempts: number;
    locked_until: Date | null;
}>;
export declare function recordLogin(id: string, ip: string, userAgent: string, client?: PoolClient): Promise<void>;
export declare function updateUserPassword(id: string, passwordHash: string, passwordHistory: string[], client?: PoolClient): Promise<User | null>;
//# sourceMappingURL=user.repository.d.ts.map