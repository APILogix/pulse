/**

 * Trusted devices — skip MFA on known fingerprints (Postgres + LRU-free).

 */
export declare function isLoginTrustedDevice(userId: string, ipAddress: string, userAgent: string): Promise<boolean>;
export declare function trustCurrentDevice(userId: string, ipAddress: string, userAgent: string, deviceName: string | undefined, requestId: string): Promise<{
    id: string;
    expires_at: Date;
}>;
export declare function listTrustedDevices(userId: string): Promise<{
    id: string;
    device_name: string | null;
    trusted_at: Date;
    expires_at: Date;
    last_seen_at: Date;
}[]>;
export declare function revokeTrustedDevice(userId: string, deviceId: string, ipAddress: string, requestId: string): Promise<void>;
//# sourceMappingURL=trusted-device.service.d.ts.map