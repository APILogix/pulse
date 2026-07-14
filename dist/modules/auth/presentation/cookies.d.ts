export declare const REFRESH_COOKIE_NAME: string;
export declare function getRefreshCookieNames(): readonly string[];
export declare function getRefreshCookieValue(cookies: Record<string, string | undefined> | undefined): string | undefined;
export declare function getRefreshCookieOptions(maxAgeSeconds?: number): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "none" | "lax";
    maxAge: number;
    path: string;
    signed: boolean;
};
//# sourceMappingURL=cookies.d.ts.map