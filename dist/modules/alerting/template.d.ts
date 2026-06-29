/** Strip control chars and escape HTML-significant characters in a value. */
export declare function sanitizeValue(value: unknown): string;
export interface RenderResult {
    output: string;
    /** Variable paths referenced by the template. */
    referenced: string[];
    /** Referenced paths that had no value in the context. */
    missing: string[];
}
/**
 * Render a template string against a context object. All substituted values
 * are sanitized; missing variables render as empty strings and are reported.
 */
export declare function renderTemplate(template: string, context: Record<string, unknown>): RenderResult;
/** Extract the unique set of variable paths a template references. */
export declare function extractVariables(template: string): string[];
//# sourceMappingURL=template.d.ts.map