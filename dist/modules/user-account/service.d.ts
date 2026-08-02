import type { FastifyRequest } from 'fastify';
import * as repo from './repository.js';
export declare class UserAccountError extends Error {
    readonly statusCode: number;
    readonly code: string;
    readonly details?: Record<string, unknown> | undefined;
    constructor(message: string, statusCode?: number, code?: string, details?: Record<string, unknown> | undefined);
}
export declare function getAccountOverview(userId: string): Promise<{
    user: {
        preferences: undefined;
        id: string;
        display_name: string | undefined;
        full_name: string | null;
        email: string;
        email_verified: boolean;
        avatar_url: string | null;
        timezone: string;
        locale: string;
    };
    security_health: {
        checks: {
            email_verified: boolean;
            mfa_enabled: boolean;
            backup_codes_remaining: number;
            has_trusted_devices: boolean;
            has_recovery_method: boolean;
        };
        status: "critical";
        actions_needed: number;
    } | {
        checks: {
            email_verified: boolean;
            mfa_enabled: boolean;
            backup_codes_remaining: number;
            has_trusted_devices: boolean;
            has_recovery_method: boolean;
        };
        status: "attention";
        actions_needed: number;
    } | {
        checks: {
            email_verified: boolean;
            mfa_enabled: boolean;
            backup_codes_remaining: number;
            has_trusted_devices: boolean;
            has_recovery_method: boolean;
        };
        status: "secure";
        actions_needed: number;
    };
    mfa_summary: {
        enabled: boolean;
        methods: {
            method: string;
            name: string | null;
            is_default: boolean;
        }[];
    };
    sessions: {
        active_count: number;
    };
    backup_codes: {
        remaining: number;
    };
    trusted_devices: {
        count: number;
    };
    passkeys: {
        count: number;
    };
    recent_activity: repo.SecurityActivityRow[];
}>;
export declare function getProfile(userId: string): Promise<{
    id: string;
    display_name: string | undefined;
    full_name: string | null;
    email: string;
    email_verified: boolean;
    avatar_url: string | null;
    timezone: string;
    locale: string;
    preferences: {
        marketing_emails: boolean;
        product_updates: boolean;
    };
}>;
export declare function updateProfile(userId: string, input: {
    display_name: string;
    full_name?: string | null | undefined;
    avatar_url?: string | null | undefined;
    timezone: string;
    locale: string;
    marketing_emails: boolean;
    product_updates: boolean;
}, request: FastifyRequest): Promise<{
    id: string;
    display_name: string | undefined;
    full_name: string | null;
    email: string;
    email_verified: boolean;
    avatar_url: string | null;
    timezone: string;
    locale: string;
    preferences: {
        marketing_emails: boolean;
        product_updates: boolean;
    };
}>;
export declare function deleteAvatar(userId: string, request: FastifyRequest): Promise<{
    id: string;
    display_name: string | undefined;
    full_name: string | null;
    email: string;
    email_verified: boolean;
    avatar_url: string | null;
    timezone: string;
    locale: string;
    preferences: {
        marketing_emails: boolean;
        product_updates: boolean;
    };
}>;
export declare function requestDataExport(userId: string, input: {
    password?: string | undefined;
    mfa_code?: string | undefined;
}, request: FastifyRequest): Promise<{
    job_id: string;
    status: string;
    estimated_minutes: number;
}>;
export declare function scheduleDeletion(userId: string, input: {
    password?: string | undefined;
    mfa_code?: string | undefined;
    confirmation_text?: string | undefined;
}, request: FastifyRequest): Promise<{
    message: string;
    grace_period_days: number;
    cancel_url: string;
}>;
export declare function cancelDeletion(userId: string, request: FastifyRequest): Promise<{
    message: string;
}>;
export declare function signOutAllOtherDevices(userId: string, currentSessionId: string, request: FastifyRequest): Promise<{
    revoked: number;
}>;
export declare function buildUserDataExport(userId: string): Promise<Record<string, unknown>>;
//# sourceMappingURL=service.d.ts.map