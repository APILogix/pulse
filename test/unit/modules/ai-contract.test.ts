import { describe, expect, it } from 'vitest';

import { AI_GOLDEN_CASES } from '../../fixtures/ai-golden-cases.js';
import { buildSystemPrompt, PROMPT_VERSION } from '../../../src/modules/ai/prompts/index.js';
import { AI_MODE_ROUTES } from '../../../src/modules/ai/feature-routes.js';
import {
  AI_MODES, DEFAULT_CREDIT_COSTS, MIN_CONFIDENCE, aiAnswerSchema,
  type AIAnswer,
} from '../../../src/modules/ai/types.js';

describe('AI enterprise golden contracts', () => {
  it('exposes one stable dedicated route for every supported AI mode', () => {
    expect(Object.keys(AI_MODE_ROUTES)).toHaveLength(AI_MODES.length);
    expect(Object.values(AI_MODE_ROUTES).sort()).toEqual([...AI_MODES].sort());
    expect(new Set(Object.values(AI_MODE_ROUTES)).size).toBe(AI_MODES.length);
  });

  it('covers every supported mode with versioned mode-specific instructions', () => {
    expect(AI_GOLDEN_CASES.map((item) => item.mode).sort()).toEqual([...AI_MODES].sort());
    for (const golden of AI_GOLDEN_CASES) {
      const prompt = buildSystemPrompt(golden.mode, {
        costs: DEFAULT_CREDIT_COSTS,
        cachedCost: 0,
        partialCost: 0,
        chargePartial: false,
      }, MIN_CONFIDENCE[golden.mode]);
      expect(prompt).toContain(`MODE: ${golden.mode}`);
      expect(prompt).toContain(`Minimum confidence for this request: ${MIN_CONFIDENCE[golden.mode]}`);
      expect(DEFAULT_CREDIT_COSTS[golden.mode]).toBeGreaterThan(0);
    }
    expect(PROMPT_VERSION).toBeGreaterThan(0);
  });

  it.each(AI_GOLDEN_CASES)('$mode validates the 17-section API contract', ({ mode, requiredSections }) => {
    const answer: AIAnswer = {
      status: 'SUCCESS', ai_mode: mode, request_id: 'request-id',
      plain_language_summary: 'Plain summary', business_impact: 'Limited impact',
      technical_analysis: 'Evidence-grounded technical analysis', likely_causes: [], evidence: [],
      confidence_score: MIN_CONFIDENCE[mode], suggested_fixes: ['Apply a reversible fix'],
      verification_steps: ['Verify metrics and traces'], prevention_recommendations: ['Add an alert'],
      missing_data: [], citations: [], safety_warnings: [],
      credit_action: {
        billable: true, amount: DEFAULT_CREDIT_COSTS[mode], reason: 'Successful answer',
        mode, status: 'SUCCESS', idempotency_key: 'idem-key', cached: false,
        refunded: false, requires_backend_confirmation: true,
      },
      metadata: { prompt_version: PROMPT_VERSION },
    };
    const parsed = aiAnswerSchema.parse(answer);
    for (const section of requiredSections) expect(parsed).toHaveProperty(section);
    expect(parsed.credit_action.requires_backend_confirmation).toBe(true);
  });
});
