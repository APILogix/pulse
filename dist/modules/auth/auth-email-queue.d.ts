import type { EmailMessage } from '../../shared/email/email.types.js';
export declare const AUTH_EMAIL_QUEUE = "auth.email";
/**
 * Enqueues an auth email to be sent asynchronously by the worker.
 * Provides safe retries, exponential backoff, and idempotency guarantees.
 */
export declare function enqueueAuthEmailJob(message: EmailMessage): Promise<void>;
//# sourceMappingURL=auth-email-queue.d.ts.map