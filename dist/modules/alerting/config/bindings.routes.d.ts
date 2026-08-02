/**
 * Alert rule binding routes.
 *
 * Architecture: docs/alerting-redesign/08-implementation-plan.md Increment 2 (API)
 *               docs/alerting-redesign/adr/0004-rule-inheritance-model.md
 *
 * Mounted under /organizations/:orgId/alerting, matching the module convention:
 *   GET    /rules/:ruleId/bindings
 *   POST   /rules/:ruleId/bindings
 *   GET    /rules/:ruleId/bindings/:bindingId
 *   PATCH  /rules/:ruleId/bindings/:bindingId
 *   DELETE /rules/:ruleId/bindings/:bindingId
 *   GET    /rules/:ruleId/effective        ← resolved rule + explainable trace
 *   GET    /rules/:ruleId/revisions
 *
 * Every route is organization-scoped and requires `authenticate` + `requireOrgAccess`, and
 * validates input with Zod before touching the service.
 */
import type { FastifyInstance } from 'fastify';
export declare function bindingsRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=bindings.routes.d.ts.map