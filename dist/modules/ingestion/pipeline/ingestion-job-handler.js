import { normalizeEvent, normalizeSdkEnvironment } from './event-normalizer.js';
import { pgboss } from '../../../lib/pgboss.js';
const ALERT_FAST_QUEUE = 'alert.evaluate.fast';
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
        const writeResult = await writer.writeBatchDetailedWithOutbox(scoped);
        if (writeResult.totalInserted > 0) {
            await enqueueFastAlertEvaluations(scoped);
        }
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
async function enqueueFastAlertEvaluations(scoped) {
    const grouped = new Map();
    for (const event of scoped) {
        if (!event.orgId)
            continue;
        const key = JSON.stringify([event.orgId, event.projectId, event.environment]);
        const list = grouped.get(key) ?? [];
        list.push(event);
        grouped.set(key, list);
    }
    await Promise.all([...grouped.values()].map((events) => {
        const first = events[0];
        return pgboss.send(ALERT_FAST_QUEUE, {
            organizationId: first.orgId,
            projectId: first.projectId,
            environment: first.environment,
            events,
        }, {
            singletonKey: `alert-fast:${first.orgId}:${first.projectId}:${hashEvents(events)}`,
            expireInSeconds: 60,
            retryLimit: 3,
            retryDelay: 1,
            retryBackoff: true,
        });
    }));
}
function hashEvents(events) {
    return events
        .map((event) => {
        const record = event.event;
        return `${String(record.type)}:${String(record.eventId ?? '')}:${String(record.timestamp ?? '')}`;
    })
        .join('|')
        .slice(0, 180);
}
//# sourceMappingURL=ingestion-job-handler.js.map