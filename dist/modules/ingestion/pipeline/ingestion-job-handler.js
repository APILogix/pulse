import { normalizeEvent } from './event-normalizer.js';
export function createIngestionJobHandler(writer, usage) {
    return async function handle(job) {
        const env = job.payload;
        const envelopes = Array.isArray(env) ? env : [env];
        const scoped = [];
        for (const e of envelopes) {
            if (!e || typeof e !== 'object')
                continue;
            // Defensive re-validation; queue payloads are untrusted at rest.
            const result = normalizeEvent(e.event);
            if (!result.ok)
                continue; // poison rows are dropped, not retried forever
            scoped.push({ projectId: e.projectId, orgId: e.orgId ?? null, event: result.event });
        }
        if (scoped.length === 0) {
            throw new Error('NO_PERSISTABLE_EVENTS');
        }
        await writer.writeBatch(scoped);
        // Fire-and-forget usage accounting (Tier-1, memory only — never awaited on
        // the persistence path, never throws). One increment per persisted event,
        // bucketed by type for per-signal usage/billing.
        if (usage) {
            for (const s of scoped) {
                if (s.orgId) {
                    usage.increment(s.projectId, s.orgId, 'events_ingested', 1);
                    usage.increment(s.projectId, s.orgId, `events_ingested:${s.event.type}`, 1);
                }
            }
        }
    };
}
//# sourceMappingURL=ingestion-job-handler.js.map