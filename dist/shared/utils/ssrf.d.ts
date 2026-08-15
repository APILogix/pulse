export declare function checkSsrf(hostname: string): string | null;
export interface ValidateUrlOptions {
    allowHttp?: boolean;
}
export declare function validateWebhookUrl(url: string, options?: ValidateUrlOptions): {
    safe: boolean;
    reason?: string;
};
//# sourceMappingURL=ssrf.d.ts.map