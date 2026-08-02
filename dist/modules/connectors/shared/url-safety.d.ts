export declare function isPrivateIp(ip: string): boolean;
/** Sync checks — safe to use inside Zod schemas. */
export declare function assertSafeHttpsUrl(raw: string): URL;
/** Async DNS check — call from the service layer at create/update time. */
export declare function assertPubliclyResolvable(u: URL): Promise<void>;
//# sourceMappingURL=url-safety.d.ts.map