/**
 * Automation Controller – transport-only Fastify route handlers.
 * All business logic delegated to AutomationService / TemplateService.
 * Zod schema validation applied at route level.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AutomationService } from './service.js';
import type { TemplateService } from './template.service.js';
import type { RequestMeta } from './types.js';

function getMeta(req: FastifyRequest): RequestMeta {
  return {
    actorUserId: req.user!.id,
    actorIp: req.ip ?? '0.0.0.0',
    actorUserAgent: req.headers['user-agent'] ?? null,
    requestId: req.id as string,
  };
}

function ok(reply: FastifyReply, data: unknown, meta?: { total: number; limit: number; offset: number }) {
  if (meta) return reply.send({ success: true, data, meta });
  return reply.send({ success: true, data });
}

export class AutomationController {
  constructor(
    private readonly service: AutomationService,
    private readonly templateService: TemplateService,
  ) {}

  // ── Workflows ───────────────────────────────────────────────────────
  async listWorkflows(req: FastifyRequest, reply: FastifyReply) {
    const { orgId } = req.params as { orgId: string };
    const q = req.query as { limit: number; offset: number; status?: string; workflowType?: string; isEnabled?: boolean; search?: string };
    const result = await this.service.listWorkflows(orgId, req.user!.id, q);
    return ok(reply, result.data, { total: result.total, limit: q.limit, offset: q.offset });
  }

  async createWorkflow(req: FastifyRequest, reply: FastifyReply) {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as any;
    const workflow = await this.service.createWorkflow(orgId, req.user!.id, body, getMeta(req));
    return reply.status(201).send({ success: true, data: workflow });
  }

  async getWorkflow(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, workflowId } = req.params as { orgId: string; workflowId: string };
    const def = await this.service.getWorkflow(orgId, req.user!.id, workflowId);
    return ok(reply, def);
  }

  async updateWorkflow(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, workflowId } = req.params as { orgId: string; workflowId: string };
    const workflow = await this.service.updateWorkflow(orgId, req.user!.id, workflowId, req.body as any, getMeta(req));
    return ok(reply, workflow);
  }

  async deleteWorkflow(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, workflowId } = req.params as { orgId: string; workflowId: string };
    await this.service.deleteWorkflow(orgId, req.user!.id, workflowId, getMeta(req));
    return reply.status(204).send();
  }

  async enableWorkflow(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, workflowId } = req.params as { orgId: string; workflowId: string };
    const wf = await this.service.enableWorkflow(orgId, req.user!.id, workflowId, getMeta(req));
    return ok(reply, wf);
  }

  async disableWorkflow(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, workflowId } = req.params as { orgId: string; workflowId: string };
    const wf = await this.service.disableWorkflow(orgId, req.user!.id, workflowId, getMeta(req));
    return ok(reply, wf);
  }

  async publishWorkflow(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, workflowId } = req.params as { orgId: string; workflowId: string };
    const body = req.body as { activateOnPublish?: boolean };
    const version = await this.service.publishWorkflow(orgId, req.user!.id, workflowId, body.activateOnPublish ?? false, getMeta(req));
    return ok(reply, version);
  }

  async testWorkflow(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, workflowId } = req.params as { orgId: string; workflowId: string };
    const body = req.body as { simulatedPayload: Record<string, unknown>; dryRun: boolean };
    const result = await this.service.testWorkflow(orgId, req.user!.id, workflowId, body.simulatedPayload, body.dryRun, getMeta(req));
    return ok(reply, result);
  }

  async runWorkflow(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, workflowId } = req.params as { orgId: string; workflowId: string };
    const body = req.body as { inputPayload: Record<string, unknown>; metadata?: Record<string, unknown> };
    const meta = getMeta(req);
    // HARDENED: Pass Idempotency-Key header
    const idempotencyKey = (req.headers['idempotency-key'] as string) ?? undefined;
    const result = await this.service.manualRun(orgId, req.user!.id, workflowId, body.inputPayload, { ...meta, idempotencyKey });
    return reply.status(201).send({ success: true, data: result });
  }

  async listWorkflowRuns(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, workflowId } = req.params as { orgId: string; workflowId: string };
    const q = req.query as { limit: number; offset: number };
    const result = await this.service.listWorkflowRuns(orgId, req.user!.id, workflowId, q);
    return ok(reply, result.data, { total: result.total, limit: q.limit, offset: q.offset });
  }

  // ── Runs ────────────────────────────────────────────────────────────
  async listRuns(req: FastifyRequest, reply: FastifyReply) {
    const { orgId } = req.params as { orgId: string };
    const q = req.query as { limit: number; offset: number; status?: string; workflowId?: string };
    const result = await this.service.listRuns(orgId, req.user!.id, q);
    return ok(reply, result.data, { total: result.total, limit: q.limit, offset: q.offset });
  }

  async getRun(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, runId } = req.params as { orgId: string; runId: string };
    const run = await this.service.getRun(orgId, req.user!.id, runId);
    return ok(reply, run);
  }

  async cancelRun(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, runId } = req.params as { orgId: string; runId: string };
    const body = (req.body as { reason?: string }) ?? {};
    const meta = getMeta(req);
    const run = await this.service.cancelRun(orgId, req.user!.id, runId, { ...meta, ...(body.reason ? { reason: body.reason } : {}) });
    return ok(reply, run);
  }

  async retryRun(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, runId } = req.params as { orgId: string; runId: string };
    const body = (req.body as { fromStep?: string }) ?? {};
    const meta = getMeta(req);
    const run = await this.service.retryRun(orgId, req.user!.id, runId, { ...meta, ...(body.fromStep ? { fromStep: body.fromStep } : {}) });
    return ok(reply, run);
  }

  async getRunSteps(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, runId } = req.params as { orgId: string; runId: string };
    const steps = await this.service.getRunSteps(orgId, req.user!.id, runId);
    return ok(reply, steps);
  }

  // ── Approvals ───────────────────────────────────────────────────────
  async listApprovals(req: FastifyRequest, reply: FastifyReply) {
    const { orgId } = req.params as { orgId: string };
    const q = req.query as { limit: number; offset: number; status?: string };
    const result = await this.service.listApprovals(orgId, req.user!.id, q);
    return ok(reply, result.data, { total: result.total, limit: q.limit, offset: q.offset });
  }

  async getApproval(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, approvalId } = req.params as { orgId: string; approvalId: string };
    const approval = await this.service.getApproval(orgId, req.user!.id, approvalId);
    return ok(reply, approval);
  }

  async approveApproval(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, approvalId } = req.params as { orgId: string; approvalId: string };
    const body = req.body as { reason?: string; decisionPayload?: Record<string, unknown> };
    const result = await this.service.approveApproval(orgId, req.user!.id, approvalId, body.reason, getMeta(req), body.decisionPayload);
    return ok(reply, result);
  }

  async rejectApproval(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, approvalId } = req.params as { orgId: string; approvalId: string };
    const body = req.body as { reason: string; decisionPayload?: Record<string, unknown> };
    const result = await this.service.rejectApproval(orgId, req.user!.id, approvalId, body.reason, getMeta(req), body.decisionPayload);
    return ok(reply, result);
  }

  // ── Templates ───────────────────────────────────────────────────────
  async listTemplates(req: FastifyRequest, reply: FastifyReply) {
    const { orgId } = req.params as { orgId: string };
    const q = req.query as { limit: number; offset: number; category?: string };
    const meta = getMeta(req);
    const result = await this.templateService.listTemplates(orgId, meta.actorUserId, q);
    return ok(reply, result.data, { total: result.total, limit: q.limit, offset: q.offset });
  }

  async getTemplate(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, templateKey } = req.params as { orgId: string; templateKey: string };
    const meta = getMeta(req);
    const result = await this.templateService.getTemplate(orgId, meta.actorUserId, templateKey);
    return ok(reply, result);
  }

  async createFromTemplate(req: FastifyRequest, reply: FastifyReply) {
    const { orgId, templateKey } = req.params as { orgId: string; templateKey: string };
    const body = req.body as { name: string; description?: string; projectId?: string; configOverrides?: Record<string, unknown>; tags?: string[]; metadata?: Record<string, unknown> };
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
  async listAudit(req: FastifyRequest, reply: FastifyReply) {
    const { orgId } = req.params as { orgId: string };
    const q = req.query as { limit: number; offset: number; workflowId?: string; runId?: string; action?: string; actorUserId?: string };
    const result = await this.service.listAudit(orgId, req.user!.id, q);
    return ok(reply, result.data, { total: result.total, limit: q.limit, offset: q.offset });
  }

  // ── Events inbox ────────────────────────────────────────────────────
  async ingestEvent(req: FastifyRequest, reply: FastifyReply) {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as any;
    const result = await this.service.ingestEvent(orgId, req.user!.id, body, getMeta(req));
    const status = result.duplicate ? 200 : 201;
    return reply.status(status).send({ success: true, data: result.event });
  }
}
