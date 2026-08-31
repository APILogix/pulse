/**
 * Unit tests for createAiSummaryGenerator (src/modules/automation/integrations.ts).
 *
 * This is the adapter that binds ai.summary.generate / ai.root_cause.generate /
 * incident.postmortem.generate_draft to the REAL AI module's AIAnalyzer, rather
 * than a fake or a second AI implementation. These tests mock AIAnalyzer.analyze
 * itself (not the OpenAI SDK several layers down), matching the same testing
 * boundary the codebase already uses for connectors (mocking NotificationDispatcher,
 * not the SMTP/HTTP client under it).
 *
 * What must hold regardless of whether AI is actually enabled on a deployment:
 *   - the workflow owner is resolved and used as the accountable AI actor
 *   - a LOCKED/FAILED/etc. answer surfaces as a genuine action failure, never a
 *     fabricated success (mirrors the INTEGRATION_NOT_CONFIGURED contract every
 *     other action-runner.ts handler follows)
 *   - the idempotency key is forwarded, namespaced under "automation:" so it can
 *     never collide with a human-actor AI request's own idempotency key
 *   - each `type` maps to the correct underlying AI_MODE
 *   - credit usage is reported back so it flows into the run's audit trail
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAiSummaryGenerator, AutomationIntegrationError } from '../../src/modules/automation/integrations.js';
import type { AutomationRepository } from '../../src/modules/automation/repository.js';

function makeAnswer(overrides: Record<string, unknown> = {}) {
  return {
    status: 'SUCCESS',
    ai_mode: 'AI_INCIDENT_SUMMARY',
    request_id: 'req-1',
    plain_language_summary: 'The checkout API is failing due to a database timeout.',
    business_impact: 'Checkout is unavailable for all users.',
    technical_analysis: 'Connection pool exhaustion under load.',
    likely_causes: [{ rank: 1, cause: 'pool exhaustion', category: 'infrastructure', confidence: 80, evidence: [], reasoning: 'connections spiked' }],
    evidence: [],
    confidence_score: 80,
    suggested_fixes: ['Increase pool size'],
    verification_steps: [],
    prevention_recommendations: ['Add pool saturation alerting'],
    missing_data: [],
    citations: [],
    safety_warnings: [],
    credit_action: { billable: true, amount: 5, reason: 'ok', mode: 'AI_INCIDENT_SUMMARY', status: 'SUCCESS', idempotency_key: 'k', cached: false, refunded: false, requires_backend_confirmation: true },
    metadata: {},
    ...overrides,
  };
}

function makeAnalyzer(answerOverrides: Record<string, unknown> = {}) {
  return {
    analyze: vi.fn().mockResolvedValue({
      answer: makeAnswer(answerOverrides),
      responseId: 'resp-1',
      reservation: null,
      usage: null,
    }),
  };
}

function makeAutomationRepo(overrides: Partial<{ createdBy: string | null; workflow: unknown }> = {}) {
  const workflow = overrides.workflow !== undefined
    ? overrides.workflow
    : { id: 'wf-1', createdBy: 'createdBy' in overrides ? overrides.createdBy : 'user-1' };
  return {
    getWorkflow: vi.fn().mockResolvedValue(workflow),
  } as unknown as AutomationRepository;
}

describe('createAiSummaryGenerator', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the workflow owner and attributes the AI call to them', async () => {
    const analyzer = makeAnalyzer();
    const repo = makeAutomationRepo({ createdBy: 'owner-42' });
    const generator = createAiSummaryGenerator(analyzer, repo);

    await generator.generateSummary({
      organizationId: 'org-1', workflowId: 'wf-1', context: { severity: 'critical' },
      type: 'summary', idempotencyKey: 'step-key-1',
    });

    expect(repo.getWorkflow).toHaveBeenCalledWith('org-1', 'wf-1');
    expect(analyzer.analyze).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ tenantId: 'org-1', userId: 'owner-42' }),
    );
  });

  it('throws when the workflow cannot be found for this organization', async () => {
    const analyzer = makeAnalyzer();
    const repo = makeAutomationRepo({ workflow: null });
    const generator = createAiSummaryGenerator(analyzer, repo);

    await expect(
      generator.generateSummary({ organizationId: 'org-1', workflowId: 'wf-missing', context: {}, type: 'summary', idempotencyKey: 'k' }),
    ).rejects.toThrow(AutomationIntegrationError);
    expect(analyzer.analyze).not.toHaveBeenCalled();
  });

  it('throws when the workflow has no owning user (created_by is null)', async () => {
    const analyzer = makeAnalyzer();
    const repo = makeAutomationRepo({ createdBy: null });
    const generator = createAiSummaryGenerator(analyzer, repo);

    await expect(
      generator.generateSummary({ organizationId: 'org-1', workflowId: 'wf-1', context: {}, type: 'summary', idempotencyKey: 'k' }),
    ).rejects.toThrow(/no owning user/);
    expect(analyzer.analyze).not.toHaveBeenCalled();
  });

  it('maps type "summary" to AI_INCIDENT_SUMMARY', async () => {
    const analyzer = makeAnalyzer();
    const repo = makeAutomationRepo();
    const generator = createAiSummaryGenerator(analyzer, repo);
    await generator.generateSummary({ organizationId: 'org-1', workflowId: 'wf-1', context: {}, type: 'summary', idempotencyKey: 'k' });
    expect(analyzer.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ ai_mode: 'AI_INCIDENT_SUMMARY' }),
      expect.any(Object),
    );
  });

  it('maps type "postmortem_draft" to AI_INCIDENT_SUMMARY (no dedicated postmortem AI_MODE exists)', async () => {
    const analyzer = makeAnalyzer();
    const repo = makeAutomationRepo();
    const generator = createAiSummaryGenerator(analyzer, repo);
    await generator.generateSummary({ organizationId: 'org-1', workflowId: 'wf-1', context: {}, type: 'postmortem_draft', idempotencyKey: 'k' });
    expect(analyzer.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ ai_mode: 'AI_INCIDENT_SUMMARY' }),
      expect.any(Object),
    );
  });

  it('maps type "root_cause" to AI_ROOT_CAUSE_ANALYSIS', async () => {
    const analyzer = makeAnalyzer();
    const repo = makeAutomationRepo();
    const generator = createAiSummaryGenerator(analyzer, repo);
    await generator.generateSummary({ organizationId: 'org-1', workflowId: 'wf-1', context: {}, type: 'root_cause', idempotencyKey: 'k' });
    expect(analyzer.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ ai_mode: 'AI_ROOT_CAUSE_ANALYSIS' }),
      expect.any(Object),
    );
  });

  it('namespaces the idempotency key under "automation:" so it cannot collide with a human AI request', async () => {
    const analyzer = makeAnalyzer();
    const repo = makeAutomationRepo();
    const generator = createAiSummaryGenerator(analyzer, repo);
    await generator.generateSummary({ organizationId: 'org-1', workflowId: 'wf-1', context: {}, type: 'summary', idempotencyKey: 'step-abc' });
    expect(analyzer.analyze).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ idempotencyKey: 'automation:step-abc' }),
    );
  });

  it('returns the summary content and credits used on SUCCESS', async () => {
    const analyzer = makeAnalyzer();
    const repo = makeAutomationRepo();
    const generator = createAiSummaryGenerator(analyzer, repo);
    const result = await generator.generateSummary({ organizationId: 'org-1', workflowId: 'wf-1', context: {}, type: 'summary', idempotencyKey: 'k' });
    expect(result.content).toContain('database timeout');
    expect(result.creditsUsed).toBe(5);
  });

  it('accepts a PARTIAL answer as success (not every field may be complete)', async () => {
    const analyzer = makeAnalyzer({ status: 'PARTIAL' });
    const repo = makeAutomationRepo();
    const generator = createAiSummaryGenerator(analyzer, repo);
    const result = await generator.generateSummary({ organizationId: 'org-1', workflowId: 'wf-1', context: {}, type: 'summary', idempotencyKey: 'k' });
    expect(result.content).toBeTruthy();
  });

  /**
   * THE CORE FAIL-CLOSED CONTRACT: when AI is disabled on this deployment
   * (AI_ENABLED unset or OPENAI_API_KEY unset), AIAnalyzer.analyze() itself
   * returns a LOCKED answer rather than throwing. This adapter must convert
   * that into a genuine thrown failure, exactly the shape action-runner.ts's
   * catch block turns into { success: false, errorCode: 'AI_GENERATION_ERROR' }
   * — never a fabricated success. This is what makes it safe to wire this
   * integration in unconditionally, whether or not AI is actually enabled.
   */
  it('surfaces a LOCKED answer (AI disabled on this deployment) as a real failure, never a fake success', async () => {
    const analyzer = makeAnalyzer({
      status: 'LOCKED',
      plain_language_summary: '',
      safety_warnings: ['AI analysis is currently disabled by the platform configuration.'],
    });
    const repo = makeAutomationRepo();
    const generator = createAiSummaryGenerator(analyzer, repo);

    await expect(
      generator.generateSummary({ organizationId: 'org-1', workflowId: 'wf-1', context: {}, type: 'summary', idempotencyKey: 'k' }),
    ).rejects.toThrow(/LOCKED/);
  });

  it('surfaces a FAILED/RATE_LIMITED/etc. answer as a real failure', async () => {
    const analyzer = makeAnalyzer({ status: 'RATE_LIMITED', safety_warnings: ['Too many requests'] });
    const repo = makeAutomationRepo();
    const generator = createAiSummaryGenerator(analyzer, repo);

    await expect(
      generator.generateSummary({ organizationId: 'org-1', workflowId: 'wf-1', context: {}, type: 'summary', idempotencyKey: 'k' }),
    ).rejects.toThrow(/RATE_LIMITED/);
  });

  it('propagates an analyzer exception rather than swallowing it', async () => {
    const analyzer = { analyze: vi.fn().mockRejectedValue(new Error('OpenAI API unreachable')) };
    const repo = makeAutomationRepo();
    const generator = createAiSummaryGenerator(analyzer, repo);

    await expect(
      generator.generateSummary({ organizationId: 'org-1', workflowId: 'wf-1', context: {}, type: 'summary', idempotencyKey: 'k' }),
    ).rejects.toThrow('OpenAI API unreachable');
  });
});
