import type { PoolClient } from 'pg';
import type { EmailMessage } from '../../../../shared/email/email.types.js';
export declare function enqueueAuthEmail(message: EmailMessage): Promise<void>;
export declare function sendAuthEmail(message: EmailMessage): Promise<void>;
export declare function processAuthEmailOutbox(batchSize?: number): Promise<number>;
export declare function purgeSentAuthEmailOutbox(olderThanDays: number, client?: PoolClient): Promise<number>;
export declare function purgeFailedAuthEmailOutbox(olderThanDays: number, client?: PoolClient): Promise<number>;
//# sourceMappingURL=email-outbox.d.ts.map