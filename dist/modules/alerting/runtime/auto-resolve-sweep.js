import { AlertRuntimeRepository } from './alert-runtime.repository.js';
import { recordAlertAutoResolved } from './alert-runtime-metrics.js';
export class AlertAutoResolveSweep {
    runtime;
    log;
    /** Guards against a slow sweep overlapping itself within one process. */
    running = false;
    constructor(logDb, logger, runtime) {
        this.runtime = runtime ?? new AlertRuntimeRepository(logDb);
        this.log = logger.child({ component: 'alert-auto-resolve-sweep' });
    }
    async run(limit = 200) {
        const result = { claimed: 0, resolved: 0, failed: 0 };
        if (this.running) {
            this.log.debug('auto-resolve sweep already in progress; skipping overlapping run');
            return result;
        }
        this.running = true;
        const startedAt = Date.now();
        try {
            // Single atomic claim: selects due rows with FOR UPDATE SKIP LOCKED and
            // clears the eligibility predicates in the same statement, so this is safe
            // to run concurrently across replicas and safe to retry.
            const claimed = await this.runtime.claimAutoResolvableAlerts(limit);
            result.claimed = claimed.length;
            if (claimed.length === 0)
                return result;
            // History rows are an audit trail, not the source of truth. A failure to
            // append history must not un-resolve the alert (the state transition has
            // already committed), so failures are counted and logged per alert rather
            // than aborting the sweep.
            const appended = await Promise.allSettled(claimed.map((row) => this.runtime.appendHistory({
                organizationId: row.organization_id,
                alertKey: row.alert_key,
                alertEventId: row.latest_event_id,
                action: 'auto_resolved',
                actorType: 'worker',
                previousState: 'firing',
                newState: 'resolved',
                metadata: {
                    reason: 'auto_resolve_deadline_elapsed',
                    // Explicitly record that this was NOT a verified recovery.
                    verifiedRecovery: false,
                },
            })));
            appended.forEach((outcome, index) => {
                if (outcome.status === 'fulfilled') {
                    result.resolved += 1;
                    recordAlertAutoResolved();
                }
                else {
                    result.failed += 1;
                    this.log.error({
                        err: outcome.reason,
                        alertKey: claimed[index].alert_key,
                        organizationId: claimed[index].organization_id,
                    }, 'auto-resolved alert but failed to append history row');
                }
            });
            this.log.info({
                claimed: result.claimed,
                resolved: result.resolved,
                failed: result.failed,
                durationMs: Date.now() - startedAt,
            }, 'auto-resolve sweep finished');
            return result;
        }
        catch (err) {
            result.failed += 1;
            this.log.error({ err, durationMs: Date.now() - startedAt }, 'auto-resolve sweep failed');
            return result;
        }
        finally {
            this.running = false;
        }
    }
}
//# sourceMappingURL=auto-resolve-sweep.js.map