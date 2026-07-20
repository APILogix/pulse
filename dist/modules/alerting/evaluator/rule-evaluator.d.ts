/**
 * Scheduled alert-rule evaluation engine (worker path ONLY — never HTTP).
 *
 * Driven by the pg-boss cron queue `alert.evaluate-rules` (see
 * alerting/queue.ts). Each tick:
 *   1. Selects enabled rules whose evaluation interval has elapsed
 *      (watermark: alert_rules.last_evaluated_at), bounded + oldest-first.
 *   2. Evaluates every condition of a rule against the observability event
 *      tables with a single bounded query per condition (see CONDITION SQL
 *      below). Unmappable conditions are skipped (debug log, fail-open).
 *   3. Combines condition outcomes with the shared grouping semantics of
 *      alerting/evaluator.ts (groups OR'd, ungrouped AND'd).
 *   4. Consecutive-breach counting in alert_rules.metadata->>'consecutiveBreaches'
 *      (required count from metadata.consecutiveBreachesRequired /
 *      annotations.consecutiveBreaches, default 1).
 *   5. Cooldown: an active alert_events row with the same fingerprint within
 *      cooldown_seconds suppresses re-firing.
 *   6. FIRE via EventsService.ingestEvent (the single ingestion entry point —
 *      fingerprint/dedup/silence/pending persist all stay in one place).
 *   7. RECOVERY: when a previously-breaching rule evaluates clear, any active
 *      event with the rule's fingerprint is resolved (resolution_reason
 *      'auto') so the alert auto-resolves.
 *   8. last_evaluated_at advances on success (incl. mapped-skip) but NOT on
 *      query error, so a failed rule is retried on the next tick.
 *
 * One bad rule never breaks the tick: every rule runs inside its own
 * try/catch and the tick processes rules with bounded concurrency.
 */
import type { FastifyBaseLogger } from 'fastify';
export interface EvaluatorTickSummary {
    rulesDue: number;
    evaluated: number;
    fired: number;
    recovered: number;
    cooldownSkipped: number;
    failed: number;
    orgsSeeded: number;
}
export declare class AlertRuleEvaluator {
    private readonly repo;
    private readonly eventsService;
    private readonly log;
    constructor(logger: FastifyBaseLogger);
    /** One evaluator tick: rule evaluation + preset seeding. Never throws. */
    runTick(limit?: number): Promise<EvaluatorTickSummary>;
    /** Enabled rules due for evaluation, oldest watermark first, bounded. */
    private findDueRules;
    /**
     * Evaluate one rule end-to-end. Returns the outcome for tick metrics.
     * Throws on query error (the caller catches and leaves the watermark).
     */
    private evaluateOneRule;
    /** Advance the watermark + persist the consecutive-breach counter atomically. */
    private markEvaluated;
    /** Dedup/cooldown fingerprint: rule.id + ':' + (project_id ?? 'org') + ':' + source. */
    private fingerprintFor;
    /** Fire the rule via EventsService.ingestEvent (dedup/silence/pending persist). */
    private fire;
    /** Resolve all active events carrying the rule fingerprint (auto-recovery). */
    private recover;
    private evaluateCondition;
    /**
     * Seed default presets for orgs that have observability traffic in the last
     * 24h but zero preset rules. One grouped query, then seed each org.
     */
    private seedPresetsForActiveOrgs;
}
//# sourceMappingURL=rule-evaluator.d.ts.map