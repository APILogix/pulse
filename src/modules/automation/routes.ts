/**
 * Automation Routes – registers all public org automation API endpoints.
 * Every route uses authenticate + requireOrgAccess.
 * Event ingestion has route-level rate limit and 256KB body validation.
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../shared/middleware/requireorg.js';
import { AutomationController } from './controller.js';
import {
  CreateWorkflowSchema,
  UpdateWorkflowSchema,
  PublishWorkflowSchema,
  TestWorkflowSchema,
  ManualRunSchema,
  ListWorkflowsQuerySchema,
  ListRunsQuerySchema,
  CancelRunSchema,
  RetryRunSchema,
  ApproveApprovalSchema,
  RejectApprovalSchema,
  CreateFromTemplateSchema,
  IngestEventSchema,
  ListAuditQuerySchema,
  ListApprovalsQuerySchema,
  PaginationSchema,
  OrgIdParamsSchema,
  WorkflowIdParamsSchema,
  RunIdParamsSchema,
  ApprovalIdParamsSchema,
  TemplateKeyParamsSchema,
} from './schemas.js';
import { LIMITS } from './types.js';

export async function automationRoutes(fastify: FastifyInstance): Promise<void> {
  const controller = new AutomationController(
    fastify.automation.service,
    fastify.automation.templateService,
  );

  // Apply auth to all routes in this scope
  fastify.addHook('onRequest', authenticate);
  fastify.addHook('onRequest', requireOrgAccess);

  // ── Workflows ─────────────────────────────────────────────────────
  fastify.get('/workflows', {
    schema: { querystring: ListWorkflowsQuerySchema, params: OrgIdParamsSchema },
  }, (req, reply) => controller.listWorkflows(req, reply));

  fastify.post('/workflows', {
    schema: { body: CreateWorkflowSchema, params: OrgIdParamsSchema },
  }, (req, reply) => controller.createWorkflow(req, reply));

  fastify.get('/workflows/:workflowId', {
    schema: { params: WorkflowIdParamsSchema },
  }, (req, reply) => controller.getWorkflow(req, reply));

  fastify.patch('/workflows/:workflowId', {
    schema: { body: UpdateWorkflowSchema, params: WorkflowIdParamsSchema },
  }, (req, reply) => controller.updateWorkflow(req, reply));

  fastify.delete('/workflows/:workflowId', {
    schema: { params: WorkflowIdParamsSchema },
  }, (req, reply) => controller.deleteWorkflow(req, reply));

  fastify.post('/workflows/:workflowId/enable', {
    schema: { params: WorkflowIdParamsSchema },
  }, (req, reply) => controller.enableWorkflow(req, reply));

  fastify.post('/workflows/:workflowId/disable', {
    schema: { params: WorkflowIdParamsSchema },
  }, (req, reply) => controller.disableWorkflow(req, reply));

  fastify.post('/workflows/:workflowId/publish', {
    schema: { body: PublishWorkflowSchema, params: WorkflowIdParamsSchema },
  }, (req, reply) => controller.publishWorkflow(req, reply));

  fastify.post('/workflows/:workflowId/test', {
    schema: { body: TestWorkflowSchema, params: WorkflowIdParamsSchema },
  }, (req, reply) => controller.testWorkflow(req, reply));

  fastify.post('/workflows/:workflowId/run', {
    schema: { body: ManualRunSchema, params: WorkflowIdParamsSchema },
  }, (req, reply) => controller.runWorkflow(req, reply));

  fastify.get('/workflows/:workflowId/runs', {
    schema: { querystring: PaginationSchema, params: WorkflowIdParamsSchema },
  }, (req, reply) => controller.listWorkflowRuns(req, reply));

  // ── Runs ──────────────────────────────────────────────────────────
  fastify.get('/runs', {
    schema: { querystring: ListRunsQuerySchema, params: OrgIdParamsSchema },
  }, (req, reply) => controller.listRuns(req, reply));

  fastify.get('/runs/:runId', {
    schema: { params: RunIdParamsSchema },
  }, (req, reply) => controller.getRun(req, reply));

  fastify.post('/runs/:runId/cancel', {
    schema: { body: CancelRunSchema, params: RunIdParamsSchema },
  }, (req, reply) => controller.cancelRun(req, reply));

  fastify.post('/runs/:runId/retry', {
    schema: { body: RetryRunSchema, params: RunIdParamsSchema },
  }, (req, reply) => controller.retryRun(req, reply));

  fastify.get('/runs/:runId/steps', {
    schema: { params: RunIdParamsSchema },
  }, (req, reply) => controller.getRunSteps(req, reply));

  // ── Approvals ─────────────────────────────────────────────────────
  fastify.get('/approvals', {
    schema: { querystring: ListApprovalsQuerySchema, params: OrgIdParamsSchema },
  }, (req, reply) => controller.listApprovals(req, reply));

  fastify.get('/approvals/:approvalId', {
    schema: { params: ApprovalIdParamsSchema },
  }, (req, reply) => controller.getApproval(req, reply));

  fastify.post('/approvals/:approvalId/approve', {
    schema: { body: ApproveApprovalSchema, params: ApprovalIdParamsSchema },
  }, (req, reply) => controller.approveApproval(req, reply));

  fastify.post('/approvals/:approvalId/reject', {
    schema: { body: RejectApprovalSchema, params: ApprovalIdParamsSchema },
  }, (req, reply) => controller.rejectApproval(req, reply));

  // ── Templates ─────────────────────────────────────────────────────
  fastify.get('/templates', {
    schema: { querystring: PaginationSchema, params: OrgIdParamsSchema },
  }, (req, reply) => controller.listTemplates(req, reply));

  fastify.get('/templates/:templateKey', {
    schema: { params: TemplateKeyParamsSchema },
  }, (req, reply) => controller.getTemplate(req, reply));

  fastify.post('/templates/:templateKey/create-workflow', {
    schema: { body: CreateFromTemplateSchema, params: TemplateKeyParamsSchema },
  }, (req, reply) => controller.createFromTemplate(req, reply));

  // ── Audit ─────────────────────────────────────────────────────────
  fastify.get('/audit', {
    schema: { querystring: ListAuditQuerySchema, params: OrgIdParamsSchema },
  }, (req, reply) => controller.listAudit(req, reply));

  // ── Events (rate limited, 256KB validation) ───────────────────────
  fastify.post('/events', {
    schema: { body: IngestEventSchema, params: OrgIdParamsSchema },
    bodyLimit: LIMITS.MAX_PAYLOAD_SIZE_BYTES,
  }, (req, reply) => controller.ingestEvent(req, reply));
}
