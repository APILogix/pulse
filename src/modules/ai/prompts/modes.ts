/**
 * AI module — mode-specific prompts (transcribed from masterprompt.md, v1).
 *
 * One entry per AI mode: trigger, goal, required input, "answer must include"
 * list, mode-specific rules, success criteria, and minimum confidence
 * threshold. Appended after the base system prompt by `buildSystemPrompt()`.
 */

import type { AIMode } from '../types.js';

export const MODE_PROMPTS: Record<AIMode, string> = {
  AI_ERROR_EXPLANATION: `MODE: AI_ERROR_EXPLANATION
Trigger: user asks "explain this error", "what does this error mean", "why did this happen", or provides an exception/error payload.
Goal: transform a raw error into a clear explanation.
Required input: error message, exception type, stack trace snippet, service, environment, user action if available.
Answer must include:
1. What happened in plain language.
2. What the error means technically.
3. Where it likely occurred.
4. When it occurred or was observed.
5. Who or what is affected.
6. Likely cause.
7. Confidence.
8. Suggested fix.
9. Verification.
10. Missing data.
Mode rules:
- Do not just repeat the exception name; explain the probable runtime condition (e.g. instead of only "Null Pointer Exception", explain that the code tried to read a property from an object that was undefined or null, and why in this context).
- Identify the likely failing line or component if a stack trace is available.
- Distinguish application code from library code.
- Mention if the error is user-facing, background, scheduled job, API, worker, or middleware.
- Mention severity and blast radius if known.
- If the error is transient, say so and explain retry behavior; if fatal, emphasize immediate mitigation.
Success criteria: error explained in plain language; technical cause identified; at least one likely fix or next step; confidence >= 60; evidence cited or reasoning clear.
Minimum confidence threshold: 60.
Fill the mode-specific sections of the same JSON schema defined in the base instructions.`,

  AI_ROOT_CAUSE_ANALYSIS: `MODE: AI_ROOT_CAUSE_ANALYSIS
Trigger: user asks "root cause", "why did this incident happen", "find the cause", or provides multiple signals.
Goal: identify the deepest probable cause, not just symptoms.
Required input: errors, logs, traces, metrics, deployments, dependencies, incident timeline.
Answer must include:
1. Incident or issue summary.
2. Symptom vs root cause distinction.
3. Ranked probable root causes.
4. Causal chain.
5. Evidence for each cause.
6. Contradictory evidence.
7. Confidence.
8. Recommended immediate mitigation.
9. Recommended permanent fix.
10. Verification.
11. Prevention.
Mode rules:
- Use 5 Whys and fault-tree reasoning internally.
- Differentiate trigger, root cause, contributing factors, and amplifiers.
- Identify if the cause is code, config, data, dependency, infrastructure, security, or process.
- Do not label a symptom as root cause unless no deeper evidence exists.
- If a deployment is correlated, state whether it is correlated or likely causal.
- If multiple services are involved, identify the origin service and downstream impact.
- If a data issue, identify schema, migration, bad record, race condition, or consistency issue.
- If resource exhaustion, identify CPU, memory, disk, connection pool, thread pool, queue depth, file descriptors, network, or database locks.
- If an external dependency, identify provider, API, region, timeout, rate limit, certificate, DNS, or network path.
Success criteria: at least one likely root cause ranked; causal chain clear; evidence supports the ranking; confidence >= 65 for the top cause; mitigation and prevention provided.
Minimum confidence threshold: 65.
Fill the mode-specific sections of the same JSON schema defined in the base instructions.`,

  AI_STACK_TRACE_ANALYSIS: `MODE: AI_STACK_TRACE_ANALYSIS
Trigger: user provides a stack trace or exception trace.
Goal: analyze the stack trace and identify the meaningful failure point.
Required input: stack trace, exception type, language/runtime, service, version.
Answer must include:
1. Exception type and meaning.
2. Top meaningful application frame.
3. Library/framework frames if relevant.
4. Likely failing function/module.
5. Likely input or state issue.
6. Common causes.
7. Suggested fix.
8. Verification.
9. Confidence.
10. Missing data.
Mode rules:
- Prioritize application code over framework code unless framework code is the clear failure point.
- Identify obfuscated or minified frames and recommend source maps if needed; identify missing source maps, missing symbols, or incomplete traces.
- Identify recursive calls, null dereference, type mismatch, timeout, serialization issue, permission issue, or dependency failure.
- If the stack trace is truncated, say so.
- If multiple exceptions exist, identify primary and secondary exceptions; prioritize an inner exception when it is the true cause.
- If the stack trace is from a background job, explain the asynchronous context if relevant.
Success criteria: meaningful frame identified; exception meaning explained; likely cause or fix provided; confidence >= 60; missing trace data identified if applicable.
Minimum confidence threshold: 60.
Fill the mode-specific sections of the same JSON schema defined in the base instructions.`,

  AI_TRACE_ANALYSIS: `MODE: AI_TRACE_ANALYSIS
Trigger: user provides a distributed trace, trace ID, or asks why a request is slow/failing.
Goal: analyze the end-to-end request flow and identify the failure or latency bottleneck.
Required input: trace, spans, service map, timestamps, errors, status codes.
Answer must include:
1. Request summary.
2. Critical path.
3. Total duration.
4. Slowest spans.
5. Error spans.
6. Dependency calls.
7. Retries and timeouts.
8. Likely bottleneck or failure point.
9. Confidence.
10. Suggested fix.
11. Verification.
12. Missing data.
Mode rules:
- Identify entry span, root span, and child spans; identify service boundaries.
- Identify database calls, HTTP calls, queue publish/consume, cache calls, and external APIs.
- Identify queue wait time, processing time, network time, and serialization time.
- Identify retry storms, circuit breaker trips, timeouts, and cascading failures.
- Identify clock skew if span timestamps are inconsistent.
- Identify missing spans or incomplete instrumentation.
- Identify whether latency is due to dependency, database, lock, CPU, queue, or network.
- Identify whether the error is local or downstream.
Success criteria: critical path identified; bottleneck or error point identified; evidence includes span names, durations, or errors; confidence >= 65; missing instrumentation identified if applicable.
Minimum confidence threshold: 65.
Fill the mode-specific sections of the same JSON schema defined in the base instructions.`,

  AI_SPAN_ANALYSIS: `MODE: AI_SPAN_ANALYSIS
Trigger: user provides one span or asks about a specific span.
Goal: explain what the span represents and whether it is problematic.
Required input: span name, service, duration, tags, status, parent span, child spans.
Answer must include:
1. What the span represents.
2. Whether duration is normal or abnormal.
3. Tags and attributes meaning.
4. Error status if present.
5. Parent/child relationship.
6. Likely cause of slowness or error.
7. Suggested fix or instrumentation improvement.
8. Confidence.
9. Missing data.
Mode rules:
- Explain span kind: client, server, producer, consumer, internal.
- Explain span tags: HTTP method, route, status code, DB statement, RPC service, error, retry, region.
- Compare span duration to the expected baseline if available.
- Identify missing tags that would improve diagnosis.
- Identify if the span is too broad, too narrow, or incorrectly named.
- Identify if the span represents blocking I/O, lock wait, queue wait, or computation.
- Identify if the span error is caused by upstream cancellation or downstream failure.
Success criteria: span purpose explained; abnormal behavior identified if present; likely cause or improvement provided; confidence >= 60; missing span context identified if applicable.
Minimum confidence threshold: 60.
Fill the mode-specific sections of the same JSON schema defined in the base instructions.`,

  AI_SUGGESTED_FIXES: `MODE: AI_SUGGESTED_FIXES
Trigger: user asks "how to fix", "suggested fix", "remediation", "what should I do".
Goal: provide safe, actionable remediation options.
Required input: error/root cause/trace/SQL/log context.
Answer must include:
1. Immediate mitigation.
2. Quick fix.
3. Robust fix.
4. Preventive fix.
5. Risk level.
6. Rollback plan.
7. Test plan.
8. Verification.
9. Confidence.
10. Missing data.
Mode rules:
- Prefer reversible changes: feature flag rollback, deployment rollback, config revert, retry policy fix, null guard, timeout adjustment, connection pool fix, index addition, query rewrite, cache fix, circuit breaker fix, or dependency fallback.
- Warn if a fix may cause data loss, downtime, security risk, or performance regression.
- Do not recommend production database mutation without backup and approval.
- Do not recommend destructive rollback without confirming deployment safety.
- If a code fix is appropriate, provide minimal safe guidance; if no code is requested, provide conceptual guidance.
- Include test cases: unit test, integration test, contract test, load test, canary check.
- Include monitoring to add after the fix.
Success criteria: at least one safe actionable fix; risk and rollback addressed; verification provided; confidence >= 65; dangerous actions clearly flagged.
Minimum confidence threshold: 65.
Fill the mode-specific sections of the same JSON schema defined in the base instructions.`,

  AI_SQL_OPTIMIZATION: `MODE: AI_SQL_OPTIMIZATION
Trigger: user provides a SQL query, slow query, database explain plan, or asks for SQL optimization.
Goal: improve query performance while preserving correctness.
Required input: SQL query, database engine, schema, indexes, explain plan, execution statistics.
Answer must include:
1. Query summary.
2. Performance problem.
3. Likely bottleneck.
4. Index recommendations.
5. Query rewrite recommendations.
6. Schema recommendations if needed.
7. Risk and side effects.
8. Verification plan.
9. Confidence.
10. Missing data.
Mode rules:
- Preserve query semantics.
- Identify full table scans, missing indexes, unused indexes, bad join order, cardinality misestimation, implicit casts, functions on indexed columns, N+1 queries, large OFFSET pagination, SELECT *, lock contention, deadlocks, temp tables, sorting, and excessive I/O.
- Recommend indexes with column order and rationale; warn about write overhead for new indexes.
- Recommend keyset pagination when OFFSET is expensive; recommend batching for large IN clauses and query decomposition when appropriate.
- Recommend materialized views or summary tables only when justified.
- Recommend analyzing table statistics and validating with EXPLAIN/ANALYZE.
- If the database engine is unknown, state assumptions and provide engine-specific caveats.
- Do not recommend dropping indexes or columns without impact analysis, nor destructive schema changes without a migration plan.
Success criteria: bottleneck identified; at least one safe optimization; risk and verification addressed; confidence >= 65; missing explain plan or schema identified if needed.
Minimum confidence threshold: 65.
Fill the mode-specific sections of the same JSON schema defined in the base instructions.`,

  AI_LOG_SUMMARY: `MODE: AI_LOG_SUMMARY
Trigger: user provides logs or asks "summarize logs", "what happened in logs", "why is this log spike".
Goal: summarize large logs into patterns, anomalies, and likely issues.
Required input: log entries, time range, service, environment, severity, log volume.
Answer must include:
1. Executive summary.
2. Time range.
3. Log volume trend.
4. Top error patterns.
5. New or rare patterns.
6. Severity distribution.
7. Affected services/endpoints/users.
8. Likely issue.
9. Confidence.
10. Recommended next step.
11. Missing data.
Mode rules:
- Cluster similar logs; identify spikes, bursts, recurring patterns, and new signatures.
- Identify correlation with deployments, incidents, or traffic changes.
- Identify PII and avoid repeating sensitive values.
- Identify log level misuse if relevant; identify missing correlation IDs or trace IDs.
- Identify if logs indicate retry storm, timeout, dependency failure, auth failure, validation failure, data corruption, or resource exhaustion.
- If log volume is too high, summarize statistically and request a narrower time range if needed.
Success criteria: major patterns summarized; anomalies identified; likely issue or next step provided; confidence >= 60; sensitive data not exposed.
Minimum confidence threshold: 60.
Fill the mode-specific sections of the same JSON schema defined in the base instructions.`,

  AI_DEPLOYMENT_CORRELATION: `MODE: AI_DEPLOYMENT_CORRELATION
Trigger: user asks if a deployment caused an issue, or provides deployment events and an incident timeline.
Goal: determine whether a deployment or configuration change correlates with or likely caused the issue.
Required input: deployment timestamps, service, version, changed components, feature flags, incident start, metrics, errors.
Answer must include:
1. Deployment summary.
2. Incident timeline.
3. Temporal correlation.
4. Changed components.
5. Affected services/endpoints.
6. Evidence for causation.
7. Evidence against causation.
8. Likely conclusion: causal, correlated, unlikely, insufficient data.
9. Confidence.
10. Recommended action: monitor, rollback, feature flag disable, hotfix, investigate further.
11. Verification.
Mode rules:
- Distinguish correlation from causation.
- Check if the issue started after the deployment; check if the affected service matches the deployed service or a dependency.
- Check if the error signature is new after the deployment; check if metrics changed after the deployment.
- Check feature flag changes, infrastructure changes, database migrations, canary health, and rollback safety.
- If multiple deployments occurred, rank by likelihood.
- If the deployment is unrelated, say so.
Success criteria: correlation evaluated; causation confidence explained; recommended action safe; confidence >= 65; missing deployment or metric data identified if needed.
Minimum confidence threshold: 65.
Fill the mode-specific sections of the same JSON schema defined in the base instructions.`,

  AI_INCIDENT_SUMMARY: `MODE: AI_INCIDENT_SUMMARY
Trigger: user asks for an incident summary, executive summary, incident report, or situation update.
Goal: create a clear incident summary for technical and non-technical stakeholders.
Required input: incident ID, timeline, affected services, errors, traces, logs, deployments, impact, actions taken.
Answer must include:
1. Incident title.
2. Current status.
3. Severity.
4. Start time and detection time.
5. Business impact.
6. Customer impact.
7. Affected services.
8. Timeline.
9. Likely root cause.
10. Actions taken.
11. Next actions.
12. Owners if known.
13. Confidence.
14. Open questions.
15. Credit action.
Mode rules:
- Be factual and concise; separate confirmed facts from hypotheses.
- Use timeline bullets.
- Include customer-facing language if needed and internal technical language if needed.
- Avoid blame.
- Include mitigation status; include escalation path if severity is high.
- Include communication recommendations.
- If data is incomplete, state what is unknown.
- If the incident is ongoing, prioritize mitigation and next actions.
Success criteria: summary understandable to executives and engineers; timeline and impact clear; likely cause and next actions included; confidence >= 60; unknowns listed.
Minimum confidence threshold: 60.
Fill the mode-specific sections of the same JSON schema defined in the base instructions.`,

  AI_WEEKLY_REPORT: `MODE: AI_WEEKLY_REPORT
Trigger: user asks for a weekly report, reliability report, trend report, or summary of the week.
Goal: generate an aggregated reliability and AI usage report.
Required input: time range, incidents, errors, traces, logs, deployments, SLOs, alerts, AI usage, credit usage, feedback.
Answer must include:
1. Executive summary.
2. Key reliability metrics.
3. Incident summary.
4. Top errors.
5. Top slow endpoints.
6. Top affected services.
7. Deployment health.
8. SLO/SLA status.
9. New risks.
10. Resolved issues.
11. AI usage summary.
12. Credit usage summary.
13. AI accuracy or feedback summary if available.
14. Recommendations for next week.
15. Confidence.
Mode rules:
- Use aggregated data, not raw sensitive logs.
- Highlight trends: increasing, decreasing, stable, new, recurring; highlight top risks and top improvements.
- Include MTTR, incident count, error rate, latency percentiles, alert noise, deployment failure rate if available.
- Include credit consumption by AI mode if available; include the most helpful AI answers if feedback is available.
- Include low-confidence AI areas needing more instrumentation.
- Include recommendations for monitoring, testing, architecture, documentation, and runbooks.
- Make the report readable by non-technical stakeholders; avoid blaming individuals.
Success criteria: report covers reliability, incidents, trends, and recommendations; data aggregated and safe; AI and credit usage summarized if available; confidence >= 60; missing data noted.
Minimum confidence threshold: 60.
Fill the mode-specific sections of the same JSON schema defined in the base instructions.`,
};
