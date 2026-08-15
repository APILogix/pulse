import { normalizeEvent, normalizeSdkEnvironment } from './event-normalizer.js';
export function createIngestionJobHandler(writer, usage) {
    return async function handle(job) {
        const env = job.payload;
        const envelopes = Array.isArray(env) ? env : [env];
        const scoped = [];
        for (const e of envelopes) {
            if (!e || typeof e !== 'object')
                continue;
            const environment = normalizeSdkEnvironment(e.environment);
            if (!environment)
                continue;
            // Defensive re-validation; queue payloads are untrusted at rest.
            const result = normalizeEvent(e.event);
            if (!result.ok)
                continue; // poison rows are dropped, not retried forever
            scoped.push({ projectId: e.projectId, orgId: e.orgId ?? null, environment, event: result.event });
        }
        if (scoped.length === 0) {
            throw new Error('NO_PERSISTABLE_EVENTS');
        }
        // Persist batch to typed tables. Transactional telemetry_outbox inside writeBatchDetailed
        // ensures atomic fast-path alert dispatch without duplicate enqueueing.
        await writer.writeBatchDetailed(scoped);
        // Fire-and-forget canonical event accounting. Signal type remains an
        // explicit rollup dimension instead of being encoded in a counter name.
        if (usage) {
            for (const scopedEvent of scoped) {
                if (scopedEvent.orgId) {
                    usage.increment(scopedEvent.projectId, scopedEvent.orgId, 'events', 1, {
                        eventType: scopedEvent.event.type,
                    });
                }
            }
        }
    };
}
//# sourceMappingURL=ingestion-job-handler.js.map