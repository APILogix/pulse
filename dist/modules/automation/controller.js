function getMeta(req) {
    return {
        actorUserId: req.user.id,
        actorIp: req.ip ?? '0.0.0.0',
        actorUserAgent: req.headers['user-agent'] ?? null,
        requestId: req.id,
    };
}
function ok(reply, data, meta) {
    if (meta)
        return reply.send({ success: true, data, meta });
    return reply.send({ success: true, data });
}
export class AutomationController {
    service;
    templateService;
    constructor(service, templateService) {
        this.service = service;
        this.templateService = templateService;
    }
    // ── Workflows ───────────────────────────────────────────────────────
    async listWorkflows(req, reply) {
        const { orgId } = req.params;
        const q = req.query;
        const result = await this.service.listWorkflows(orgId, req.user.id, q);
        return ok(reply, result.data, { total: result.total, limit: q.limit, offset: q.offset });
    }
    async createWorkflow(req, reply) {
        const { orgId } = req.params;
        const body = req.body;
        const workflow = await this.service.createWorkflow(orgId, req.user.id, body, getMeta(req));
        return reply.status(201).send({ success: true, data: workflow });
    }
    async getWorkflow(req, reply) {
        const { orgId, workflowId } = req.params;
        const def = await this.service.getWorkflow(orgId, req.user.id, workflowId);
        return ok(reply, def);
    }
    async updateWorkflow(req, reply) {
        const { orgId, workflowId } = req.params;
        const workflow = await this.service.updateWorkflow(orgId, req.user.id, workflowId, req.body, getMeta(req));
        return ok(reply, workflow);
    }
    async deleteWorkflow(req, reply) {
        const { orgId, workflowId } = req.params;
        await this.service.deleteWorkflow(orgId, req.user.id, workflowId, getMeta(req));
        return reply.status(204).send();
    }
    async enableWorkflow(req, reply) {
        const { orgId, workflowId } = req.params;
        const wf = await this.service.enableWorkflow(orgId, req.user.id, workflowId, getMeta(req));
        return ok(reply, wf);
    }
    async disableWorkflow(req, reply) {
        const { orgId, workflowId } = req.params;
        const wf = await this.service.disableWorkflow(orgId, req.user.id, workflowId, getMeta(req));
        return ok(reply, wf);
    }
    async publishWorkflow(req, reply) {
        const { orgId, workflowId } = req.params;
        const body = req.body;
        const version = await this.service.publishWorkflow(orgId, req.user.id, workflowId, body.activateOnPublish ?? false, getMeta(req));
        return ok(reply, version);
    }
    async testWorkflow(req, reply) {
        const { orgId, workflowId } = req.params;
        const body = req.body;
        const result = await this.service.testWorkflow(orgId, req.user.id, workflowId, body.simulatedPayload, body.dryRun, getMeta(req));
        return ok(reply, result);
    }
    async runWorkflow(req, reply) {
        const { orgId, workflowId } = req.params;
        const body = req.body;
        const meta = getMeta(req);
        // HARDENED: Pass Idempotency-Key header
        const idempotencyKey = req.headers['idempotency-key'] ?? undefined;
        const result = await this.service.manualRun(orgId, req.user.id, workflowId, body.inputPayload, { ...meta, idempotencyKey });
        return reply.status(201).send({ success: true, data: result });
    }
    async listWorkflowRuns(req, reply) {
        const { orgId, workflowId } = req.params;
        const q = req.query;
        const result = await this.service.listWorkflowRuns(orgId, req.user.id, workflowId, q);
        return ok(reply, result.data, { total: result.total, limit: q.limit, offset: q.offset });
    }
    // ── Runs ────────────────────────────────────────────────────────────
    async listRuns(req, reply) {
        const { orgId } = req.params;
        const q = req.query;
        const result = await this.service.listRuns(orgId, req.user.id, q);
        return ok(reply, result.data, { total: result.total, limit: q.limit, offset: q.offset });
    }
    async getRun(req, reply) {
        const { orgId, runId } = req.params;
        const run = await this.service.getRun(orgId, req.user.id, runId);
        return ok(reply, run);
    }
    async cancelRun(req, reply) {
        const { orgId, runId } = req.params;
        const body = req.body ?? {};
        const meta = getMeta(req);
        const run = await this.service.cancelRun(orgId, req.user.id, runId, { ...meta, ...(body.reason ? { reason: body.reason } : {}) });
        return ok(reply, run);
    }
    async retryRun(req, reply) {
        const { orgId, runId } = req.params;
        const body = req.body ?? {};
        const meta = getMeta(req);
        const run = await this.service.retryRun(orgId, req.user.id, runId, { ...meta, ...(body.fromStep ? { fromStep: body.fromStep } : {}) });
        return ok(reply, run);
    }
    async getRunSteps(req, reply) {
        const { orgId, runId } = req.params;
        const steps = await this.service.getRunSteps(orgId, req.user.id, runId);
        return ok(reply, steps);
    }
    // ── Approvals ───────────────────────────────────────────────────────
    async listApprovals(req, reply) {
        const { orgId } = req.params;
        const q = req.query;
        const result = await this.service.listApprovals(orgId, req.user.id, q);
        return ok(reply, result.data, { total: result.total, limit: q.limit, offset: q.offset });
    }
    async getApproval(req, reply) {
        const { orgId, approvalId } = req.params;
        const approval = await this.service.getApproval(orgId, req.user.id, approvalId);
        return ok(reply, approval);
    }
    async approveApproval(req, reply) {
        const { orgId, approvalId } = req.params;
        const body = req.body;
        const result = await this.service.approveApproval(orgId, req.user.id, approvalId, body.reason, getMeta(req), body.decisionPayload);
        return ok(reply, result);
    }
    async rejectApproval(req, reply) {
        const { orgId, approvalId } = req.params;
        const body = req.body;
        const result = await this.service.rejectApproval(orgId, req.user.id, approvalId, body.reason, getMeta(req), body.decisionPayload);
        return ok(reply, result);
    }
    // ── Templates ───────────────────────────────────────────────────────
    async listTemplates(req, reply) {
        const { orgId } = req.params;
        const q = req.query;
        const meta = getMeta(req);
        const result = await this.templateService.listTemplates(orgId, meta.actorUserId, q);
        return ok(reply, result.data, { total: result.total, limit: q.limit, offset: q.offset });
    }
    async getTemplate(req, reply) {
        const { orgId, templateKey } = req.params;
        const meta = getMeta(req);
        const result = await this.templateService.getTemplate(orgId, meta.actorUserId, templateKey);
        return ok(reply, result);
    }
    async createFromTemplate(req, reply) {
        const { orgId, templateKey } = req.params;
        const body = req.body;
        const meta = getMeta(req);
        const workflow = await this.templateService.createWorkflowFromTemplate({
            orgId, userId: meta.actorUserId, templateKey, name: body.name,
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
            ...(body.configOverrides !== undefined ? { configOverrides: body.configOverrides } : {}),
            ...(body.tags !== undefined ? { tags: body.tags } : {}),
            ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
            meta,
        });
        return reply.status(201).send({ success: true, data: workflow });
    }
    // ── Audit ───────────────────────────────────────────────────────────
    async listAudit(req, reply) {
        const { orgId } = req.params;
        const q = req.query;
        const result = await this.service.listAudit(orgId, req.user.id, q);
        return ok(reply, result.data, { total: result.total, limit: q.limit, offset: q.offset });
    }
    // ── Events inbox ────────────────────────────────────────────────────
    async ingestEvent(req, reply) {
        const { orgId } = req.params;
        const body = req.body;
        const result = await this.service.ingestEvent(orgId, req.user.id, body, getMeta(req));
        const status = result.duplicate ? 200 : 201;
        return reply.status(status).send({ success: true, data: result.event });
    }
}
//# sourceMappingURL=controller.js.map