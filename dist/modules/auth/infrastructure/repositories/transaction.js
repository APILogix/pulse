import { pool } from '../../../../config/database.js';
import { logger } from '../../../../config/logger.js';
const repositoryLogger = logger.child({ component: 'auth-repository' });
function shouldDestroyTransactionClient(error) {
    const pgCode = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : '';
    const message = error instanceof Error ? error.message : String(error);
    return (pgCode.startsWith('08') ||
        pgCode === '57P01' ||
        pgCode === '57P02' ||
        pgCode === '57P03' ||
        message.includes('Query read timeout') ||
        message.includes('Connection terminated') ||
        message.includes('Connection ended unexpectedly') ||
        message.includes('Connection terminated unexpectedly'));
}
// ============================================================================
// TRANSACTION HELPERS
// ============================================================================
export async function withTransaction(fn) {
    const client = await pool.connect();
    let transactionError;
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (e) {
        transactionError = e;
        try {
            await client.query('ROLLBACK');
        }
        catch (rollbackError) {
            repositoryLogger.warn({ err: rollbackError, originalError: e }, 'Failed to rollback auth transaction; preserving original error');
        }
        throw e;
    }
    finally {
        if (transactionError && shouldDestroyTransactionClient(transactionError)) {
            client.release(transactionError instanceof Error
                ? transactionError
                : new Error('Destroying transaction client after connection-level failure'));
        }
        else {
            client.release();
        }
    }
}
//# sourceMappingURL=transaction.js.map