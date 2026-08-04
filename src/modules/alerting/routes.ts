import type { FastifyInstance } from 'fastify';
import { rulesRoutes } from './rules/rules.routes.js';
import { bindingsRoutes } from './config/bindings.routes.js';
import { eventsRoutes } from './events/events.routes.js';
import { silencesRoutes } from './silences/silences.routes.js';
import { policiesRoutes } from './policies/policies.routes.js';
import { templatesRoutes } from './templates/templates.routes.js';
import { routingRoutes } from './routing/routing.routes.js';
import { metricsRoutes } from './metrics/metrics.routes.js';
import { policyRoutes } from './policy/policy.routes.js';

export async function alertingRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(rulesRoutes);
  // Rule bindings + effective rule resolution (ADR-0004). Registered after rulesRoutes so the
  // more specific /rules/:ruleId/bindings paths sit alongside the rule CRUD routes.
  await fastify.register(bindingsRoutes);
  await fastify.register(eventsRoutes);
  await fastify.register(silencesRoutes);
  await fastify.register(policiesRoutes);
  await fastify.register(templatesRoutes);
  await fastify.register(routingRoutes);
  await fastify.register(metricsRoutes);
  await fastify.register(policyRoutes);
}
