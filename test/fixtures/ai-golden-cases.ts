import type { AIMode } from '../../src/modules/ai/types.js';

export interface AIGoldenCase {
  mode: AIMode;
  query: string;
  requiredSections: string[];
}

const common = ['plain_language_summary', 'technical_analysis', 'evidence', 'confidence_score', 'suggested_fixes', 'verification_steps', 'missing_data', 'credit_action'];

export const AI_GOLDEN_CASES: AIGoldenCase[] = [
  { mode: 'AI_ERROR_EXPLANATION', query: 'Explain this TypeError', requiredSections: common },
  { mode: 'AI_ROOT_CAUSE_ANALYSIS', query: 'Find the root cause across logs and traces', requiredSections: [...common, 'likely_causes', 'prevention_recommendations'] },
  { mode: 'AI_STACK_TRACE_ANALYSIS', query: 'Analyze this stack trace', requiredSections: common },
  { mode: 'AI_TRACE_ANALYSIS', query: 'Find the distributed trace bottleneck', requiredSections: common },
  { mode: 'AI_SPAN_ANALYSIS', query: 'Explain this slow database span', requiredSections: common },
  { mode: 'AI_SUGGESTED_FIXES', query: 'Give safe remediation and rollback steps', requiredSections: [...common, 'safety_warnings'] },
  { mode: 'AI_SQL_OPTIMIZATION', query: 'Optimize this PostgreSQL query safely', requiredSections: [...common, 'safety_warnings'] },
  { mode: 'AI_LOG_SUMMARY', query: 'Summarize this log spike', requiredSections: common },
  { mode: 'AI_DEPLOYMENT_CORRELATION', query: 'Did this deployment cause the incident?', requiredSections: [...common, 'likely_causes'] },
  { mode: 'AI_INCIDENT_SUMMARY', query: 'Create an executive incident summary', requiredSections: common },
  { mode: 'AI_WEEKLY_REPORT', query: 'Create the weekly reliability report', requiredSections: [...common, 'business_impact', 'prevention_recommendations'] },
];
