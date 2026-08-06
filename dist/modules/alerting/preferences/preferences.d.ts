export interface NotificationPreference {
    enabled: boolean;
    vacationUntil?: Date | null;
    temporaryMuteUntil?: Date | null;
    quietHours?: {
        start: string;
        end: string;
        timezone?: string;
    } | null;
}
export declare function isNotificationSuppressed(preference: NotificationPreference, now?: Date): boolean;
export interface CorrelationKeyInput {
    organizationId: string;
    projectId?: string | null;
    policyId: string;
    environment?: string | null;
    service?: string | null;
    dimension?: string | null;
}
export declare function correlationKey(input: CorrelationKeyInput): string;
export declare function digestCount(count: number, maxItems?: number): {
    collapsed: boolean;
    included: number;
};
//# sourceMappingURL=preferences.d.ts.map