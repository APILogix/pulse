import { type CreateUserInput, type DeleteUserInput, type ListUsersQueryInput, type AdminLockUserInput, type UpdateUserInput, type UserProfile, type UserSecuritySummary } from '../../domain/types.js';
/**
 * Register a user. To prevent email-existence enumeration, the route always
 * returns a generic 201 message regardless of whether the email is already
 * taken. When the email IS already taken we silently no-op (no second user
 * created) and emit an audit-only event so security teams can detect probes.
 */
export declare function createUserFromEmail(input: CreateUserInput, ipAddress: string, requestId: string): Promise<void>;
export declare function getCurrentUser(userId: string): Promise<UserProfile>;
export declare function updateCurrentUser(userId: string, input: UpdateUserInput): Promise<UserProfile>;
export declare function deleteCurrentUser(userId: string, input: DeleteUserInput, ipAddress: string, requestId: string): Promise<void>;
export declare function getUserById(targetUserId: string, requesterId: string, isAdmin: boolean): Promise<UserProfile>;
export declare function listAllUsers(options: ListUsersQueryInput, isAdmin: boolean): Promise<{
    users: UserProfile[];
    total: number;
}>;
export declare function restoreDeletedUser(targetUserId: string, adminId: string, isAdmin: boolean, ipAddress: string, requestId: string): Promise<UserProfile>;
export declare function suspendUser(targetUserId: string, reason: string, adminId: string, isAdmin: boolean, ipAddress: string, requestId: string): Promise<UserProfile>;
export declare function unsuspendUser(targetUserId: string, adminId: string, isAdmin: boolean, ipAddress: string, requestId: string): Promise<UserProfile>;
export declare function adminLockUserAccount(targetUserId: string, input: AdminLockUserInput, adminId: string, isAdmin: boolean, ipAddress: string, requestId: string): Promise<UserProfile>;
export declare function adminUnlockUserAccount(targetUserId: string, adminId: string, isAdmin: boolean, ipAddress: string, requestId: string): Promise<UserProfile>;
/**
 * Revoke every active session for a target user (platform admin support).
 */
export declare function adminRevokeAllUserSessions(targetUserId: string, adminId: string, isAdmin: boolean, ipAddress: string, requestId: string): Promise<{
    revoked: number;
}>;
export declare function getUserSecuritySummary(userId: string): Promise<UserSecuritySummary>;
//# sourceMappingURL=user-lifecycle.service.d.ts.map