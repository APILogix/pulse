export declare function checkSsrf(hostname: string): string | null;
export interface ValidateUrlOptions {
    allowHttp?: boolean;
}
export declare function validateWebhookUrl(url: string, options?: ValidateUrlOptions): {
    safe: boolean;
    reason?: string;
};
/**
 * Asynchronously validates a webhook destination URL, resolving DNS records to
 * protect against DNS rebinding and internal subnet routing attacks.
 */
export declare function validateWebhookUrlAsync(url: string, options?: ValidateUrlOptions): Promise<{
    safe: boolean;
    reason?: string;
}>;
//# sourceMappingURL=ssrf.d.ts.map