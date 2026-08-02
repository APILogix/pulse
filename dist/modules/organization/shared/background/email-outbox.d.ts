import type { EmailTemplate } from '../../../../shared/email/templates.js';
export interface EnqueueOrgEmailInput {
    orgId: string;
    /** Optional project scope (e.g. per-project latency alert). */
    projectId?: string | null;
    /** Classification tag, e.g. 'invitation', 'latency_alert'. */
    emailType: string;
    toEmail: string;
    /** Rendered template (subject/html/text). */
    template: EmailTemplate;
    /** Idempotency key — at most one non-failed row per key. */
    dedupeKey?: string | null;
    maxAttempts?: number;
    metadata?: Record<string, unknown>;
}
/**
 * Enqueue an org/project email for durable, retrying delivery.
 *
 * Returns the new row id, or null when a non-failed row with the same
 * dedupe_key already exists (the insert is a no-op in that case).
 */
export declare function enqueueOrgEmail(input: EnqueueOrgEmailInput): Promise<string | null>;
/**
 * Process a batch of due org emails. Picks pending rows whose next_attempt_at
 * has passed and that still have retries left, locking them with SKIP LOCKED so
 * concurrent workers never grab the same row. Returns the count sent.
 */
export declare function processOrgEmailOutbox(batchSize?: number): Promise<number>;
//# sourceMappingURL=email-outbox.d.ts.map