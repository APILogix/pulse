import type { Pool } from 'pg';
import type { NotificationProvider, NotificationRecipientType } from './notification-entitlement.service.js';
export type RestrictedRoutingReason = 'EMAIL_ONLY_RESTRICTED' | 'OWNER_EMAIL_UNAVAILABLE';
export interface ProjectOwnerIdentity {
    userId: string;
    email: string;
}
export interface ProjectOwnerReader {
    findActiveVerifiedOwner(organizationId: string, projectId: string): Promise<ProjectOwnerIdentity | null>;
    findActiveVerifiedFallbackRecipient?(organizationId: string, projectId?: string | null): Promise<ProjectOwnerIdentity | null>;
}
export interface RestrictedEmailTarget {
    channelKind: 'email';
    channelId: null;
    connectorId: null;
    recipientUserId: string;
    recipientRef: string;
    routeId: null;
    deliveryMode: 'EMAIL_ONLY_RESTRICTED';
    recipientType: Extract<NotificationRecipientType, 'PROJECT_OWNER' | 'ORGANIZATION_FALLBACK'>;
    provider: Extract<NotificationProvider, 'MANAGED_EMAIL'>;
}
export interface RestrictedRoutingResult {
    target: RestrictedEmailTarget | null;
    reason: RestrictedRoutingReason;
}
export declare class ProjectOwnerRepository implements ProjectOwnerReader {
    private readonly db;
    constructor(db?: Pool);
    findActiveVerifiedOwner(organizationId: string, projectId: string): Promise<ProjectOwnerIdentity | null>;
    findActiveVerifiedFallbackRecipient(organizationId: string, _projectId?: string | null): Promise<ProjectOwnerIdentity | null>;
}
export declare class EmailOnlyRestrictedRouting {
    private readonly owners;
    constructor(owners?: ProjectOwnerReader);
    resolve(organizationId: string, projectId: string): Promise<RestrictedRoutingResult>;
}
//# sourceMappingURL=email-only-restricted-routing.d.ts.map