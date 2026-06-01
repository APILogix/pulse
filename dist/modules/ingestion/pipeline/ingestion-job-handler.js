import { normalizeEvent } from './event-normalizer.js';
export function createIngestionJobHandler(writer) {
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
    };
}
//# sourceMappingURL=ingestion-job-handler.js.map