import { authenticate } from '../../../shared/middleware/auth.js';
import { BillingAuditLogsController } from './controller.js';
import { BillingAuditLogsRepository } from './repository.js';
import { BillingAuditLogsService } from './service.js';
export async function billingAuditLogsRoutes(fastify, options) {
    const repository = new BillingAuditLogsRepository();
    const service = new BillingAuditLogsService(repository);
    const controller = new BillingAuditLogsController(service);
    fastify.addHook('preHandler', authenticate);
    fastify.get('/', controller.listAuditLogs);
}
//# sourceMappingURL=routes.js.map