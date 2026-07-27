import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { AutomationRepository } from './repository.js';
import { AutomationService } from './service.js';
import { TemplateService } from './template.service.js';
import { AutomationAuditRepository } from './audit.js';
declare module 'fastify' {
    interface FastifyInstance {
        automation: {
            repository: AutomationRepository;
            service: AutomationService;
            templateService: TemplateService;
            auditRepository: AutomationAuditRepository;
        };
    }
}
declare function automationModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerAutomationModule: typeof automationModule;
export default registerAutomationModule;
//# sourceMappingURL=automation.module.d.ts.map