import type { EmailMessage } from '../../shared/email/email.types.js';
export declare function isAsyncEmailEnabled(): boolean;
export declare function enqueueAuthEmail(message: EmailMessage): Promise<void>;
export declare function sendAuthEmail(message: EmailMessage): Promise<void>;
export declare function processAuthEmailOutbox(batchSize?: number): Promise<number>;
//# sourceMappingURL=email-outbox.d.ts.map