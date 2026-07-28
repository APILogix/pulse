/**
 * Automation Controller – transport-only Fastify route handlers.
 * All business logic delegated to AutomationService / TemplateService.
 * Zod schema validation applied at route level.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AutomationService } from './service.js';
import type { TemplateService } from './template.service.js';
export declare class AutomationController {
    private readonly service;
    private readonly templateService;
    constructor(service: AutomationService, templateService: TemplateService);
    listWorkflows(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    createWorkflow(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    getWorkflow(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    updateWorkflow(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    deleteWorkflow(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    enableWorkflow(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    disableWorkflow(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    publishWorkflow(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    testWorkflow(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    runWorkflow(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    listWorkflowRuns(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    listRuns(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    getRun(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    cancelRun(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    retryRun(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    getRunSteps(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    listApprovals(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    getApproval(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    approveApproval(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    rejectApproval(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    listTemplates(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    getTemplate(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    createFromTemplate(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    listAudit(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    ingestEvent(req: FastifyRequest, reply: FastifyReply): Promise<never>;
}
//# sourceMappingURL=controller.d.ts.map