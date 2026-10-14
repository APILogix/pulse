import { pool, withTransaction as dbWithTransaction } from '../../../../config/database.js';
import { logger } from '../../../../config/logger.js';
const repositoryLogger = logger.child({ component: 'auth-repository' });
// ============================================================================
// TRANSACTION HELPERS
// ============================================================================
export async function withTransaction(fn) {
    return dbWithTransaction(fn, pool);
}
//# sourceMappingURL=transaction.js.map