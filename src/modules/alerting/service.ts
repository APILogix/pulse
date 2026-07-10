import type { FastifyBaseLogger } from 'fastify';
import { AlertingRepository } from './repository.js';
import { RulesService } from './rules/rules.service.js';
import { EventsService } from './events/events.service.js';
import { SilencesService } from './silences/silences.service.js';
import { PoliciesService } from './policies/policies.service.js';
import { TemplatesService } from './templates/templates.service.js';
import { RoutingService } from './routing/routing.service.js';
import { MetricsService } from './metrics/metrics.service.js';
import type { RequestMeta } from './types.js';
import type { CreateRuleBody, ListRulesQuery, UpdateRuleBody, TestRuleBody, IngestEventBody, ListEventsQuery, AcknowledgeEventBody, ResolveEventBody, CreateSilenceBody, CreateEscalationPolicyBody, UpsertEscalationStepBody, CreateTemplateBody, CreateRoutingRuleBody, TestRoutingBody, MetricsQuery } from "./types.js";

export * from './rules/rules.service.js';
export * from './events/events.service.js';
export * from './silences/silences.service.js';
export * from './policies/policies.service.js';
export * from './templates/templates.service.js';
export * from './routing/routing.service.js';
export * from './metrics/metrics.service.js';

export interface AlertingServiceDeps {
  repository: AlertingRepository;
  logger: FastifyBaseLogger;
}

export class AlertingService {
  private readonly rules: RulesService;
  private readonly events: EventsService;
  private readonly silences: SilencesService;
  private readonly policies: PoliciesService;
  private readonly templates: TemplatesService;
  private readonly routing: RoutingService;
  private readonly metrics: MetricsService;

  constructor(deps: AlertingServiceDeps) {
    this.rules = new RulesService(deps);
    this.events = new EventsService(deps);
    this.silences = new SilencesService(deps);
    this.policies = new PoliciesService(deps);
    this.templates = new TemplatesService(deps);
    this.routing = new RoutingService(deps);
    this.metrics = new MetricsService(deps);
  }

  async createRule(orgId: string, meta: RequestMeta, body: CreateRuleBody): Promise<Promise<Record<string, unknown>>> {
    return this.rules.createRule(orgId, meta, body);
  }

  async listRules(orgId: string, query: ListRulesQuery): Promise<Promise<{ data: Record<string, unknown>[]; total: number }>> {
    return this.rules.listRules(orgId, query);
  }

  async getRule(orgId: string, id: string): Promise<Promise<Record<string, unknown>>> {
    return this.rules.getRule(orgId, id);
  }

  async updateRule(orgId: string, meta: RequestMeta, id: string, body: UpdateRuleBody): Promise<Promise<Record<string, unknown>>> {
    return this.rules.updateRule(orgId, meta, id, body);
  }

  async deleteRule(orgId: string, meta: RequestMeta, id: string): Promise<Promise<void>> {
    return this.rules.deleteRule(orgId, meta, id);
  }

  async setRuleEnabled(orgId: string, meta: RequestMeta, id: string, enabled: boolean): Promise<Promise<Record<string, unknown>>> {
    return this.rules.setRuleEnabled(orgId, meta, id, enabled);
  }

  async cloneRule(orgId: string, meta: RequestMeta, id: string): Promise<Promise<Record<string, unknown>>> {
    return this.rules.cloneRule(orgId, meta, id);
  }

  async testRule(orgId: string, id: string, body: TestRuleBody): Promise<Promise<Record<string, unknown>>> {
    return this.rules.testRule(orgId, id, body);
  }

  async ingestEvent(orgId: string, body: IngestEventBody): Promise<Promise<Record<string, unknown>>> {
    return this.events.ingestEvent(orgId, body);
  }

  async listEvents(orgId: string, query: ListEventsQuery): Promise<Promise<{ data: Record<string, unknown>[]; total: number }>> {
    return this.events.listEvents(orgId, query);
  }

  async getEvent(orgId: string, id: string): Promise<Promise<Record<string, unknown>>> {
    return this.events.getEvent(orgId, id);
  }

  async getEventDeliveries(orgId: string, id: string): Promise<Promise<Record<string, unknown>[]>> {
    return this.events.getEventDeliveries(orgId, id);
  }

  async acknowledgeEvent(orgId: string, meta: RequestMeta, id: string, body: AcknowledgeEventBody): Promise<Promise<Record<string, unknown>>> {
    return this.events.acknowledgeEvent(orgId, meta, id, body);
  }

  async resolveEvent(orgId: string, meta: RequestMeta, id: string, body: ResolveEventBody): Promise<Promise<Record<string, unknown>>> {
    return this.events.resolveEvent(orgId, meta, id, body);
  }

  async silenceFromEvent(orgId: string, meta: RequestMeta, id: string, durationMinutes: number, comment: string | null): Promise<Promise<Record<string, unknown>>> {
    return this.events.silenceFromEvent(orgId, meta, id, durationMinutes, comment);
  }

  async createSilence(orgId: string, meta: RequestMeta, body: CreateSilenceBody): Promise<Promise<Record<string, unknown>>> {
    return this.silences.createSilence(orgId, meta, body);
  }

  async listSilences(orgId: string, active: boolean | undefined, limit: number, offset: number): Promise<Promise<{ data: Record<string, unknown>[]; total: number }>> {
    return this.silences.listSilences(orgId, active, limit, offset);
  }

  async expireSilence(orgId: string, meta: RequestMeta, id: string): Promise<Promise<void>> {
    return this.silences.expireSilence(orgId, meta, id);
  }

  async createEscalationPolicy(orgId: string, meta: RequestMeta, body: CreateEscalationPolicyBody): Promise<Promise<Record<string, unknown>>> {
    return this.policies.createEscalationPolicy(orgId, meta, body);
  }

  async listEscalationPolicies(orgId: string, limit: number, offset: number): Promise<Promise<{ data: Record<string, unknown>[]; total: number }>> {
    return this.policies.listEscalationPolicies(orgId, limit, offset);
  }

  async getEscalationPolicy(orgId: string, id: string): Promise<Promise<Record<string, unknown>>> {
    return this.policies.getEscalationPolicy(orgId, id);
  }

  async deleteEscalationPolicy(orgId: string, meta: RequestMeta, id: string): Promise<Promise<void>> {
    return this.policies.deleteEscalationPolicy(orgId, meta, id);
  }

  async upsertEscalationStep(orgId: string, meta: RequestMeta, policyId: string, body: UpsertEscalationStepBody): Promise<Promise<Record<string, unknown>>> {
    return this.policies.upsertEscalationStep(orgId, meta, policyId, body);
  }

  async createTemplate(orgId: string, meta: RequestMeta, body: CreateTemplateBody): Promise<Promise<Record<string, unknown>>> {
    return this.templates.createTemplate(orgId, meta, body);
  }

  async listTemplates(orgId: string, limit: number, offset: number): Promise<Promise<{ data: Record<string, unknown>[]; total: number }>> {
    return this.templates.listTemplates(orgId, limit, offset);
  }

  async deleteTemplate(orgId: string, meta: RequestMeta, id: string): Promise<Promise<void>> {
    return this.templates.deleteTemplate(orgId, meta, id);
  }

  async previewTemplate(orgId: string, id: string, sampleData?: Record<string, unknown>): Promise<Promise<Record<string, unknown>>> {
    return this.templates.previewTemplate(orgId, id, sampleData);
  }

  async createRoutingRule(orgId: string, meta: RequestMeta, body: CreateRoutingRuleBody): Promise<Promise<Record<string, unknown>>> {
    return this.routing.createRoutingRule(orgId, meta, body);
  }

  async listRoutingRules(orgId: string): Promise<Promise<Record<string, unknown>[]>> {
    return this.routing.listRoutingRules(orgId);
  }

  async deleteRoutingRule(orgId: string, meta: RequestMeta, id: string): Promise<Promise<void>> {
    return this.routing.deleteRoutingRule(orgId, meta, id);
  }

  async testRouting(orgId: string, body: TestRoutingBody): Promise<Promise<Record<string, unknown>>> {
    return this.routing.testRouting(orgId, body);
  }

  async getMetrics(orgId: string, query: MetricsQuery): Promise<Promise<Record<string, unknown>[]>> {
    return this.metrics.getMetrics(orgId, query);
  }

  async getStats(orgId: string): Promise<Promise<Record<string, unknown>>> {
    return this.metrics.getStats(orgId);
  }
}
