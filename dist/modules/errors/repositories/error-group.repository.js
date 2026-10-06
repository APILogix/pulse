import { isReleaseEligible, normalizeSeverity, severityRank, } from '../fingerprint.js';
export const ERROR_GROUP_COLUMNS = `
  id, public_id, organization_id, project_id, fingerprint, fingerprint_version,
  status, occurrence_count, first_seen_at, last_seen_at, first_event_id,
  latest_event_id, latest_event_occurred_at, highest_severity, latest_severity,
  regression_count, last_regressed_at, latest_release, latest_sdk_version,
  latest_application_version, latest_environment, latest_service, resolved_at,
  resolved_release, last_error_message, last_error_name, last_status_code,
  last_trace_id, last_request_id, merged_into, is_merged, version, created_at, updated_at
`;
export const ERROR_GROUP_QUALIFIED_COLUMNS = `
  g.id, g.public_id, g.organization_id, g.project_id, g.fingerprint, g.fingerprint_version,
  g.status, g.occurrence_count, g.first_seen_at, g.last_seen_at, g.first_event_id,
  g.latest_event_id, g.latest_event_occurred_at, g.highest_severity, g.latest_severity,
  g.regression_count, g.last_regressed_at, g.latest_release, g.latest_sdk_version,
  g.latest_application_version, g.latest_environment, g.latest_service, g.resolved_at,
  g.resolved_release, g.last_error_message, g.last_error_name, g.last_status_code,
  g.last_trace_id, g.last_request_id, g.merged_into, g.is_merged, g.version, g.created_at, g.updated_at
`;
function groupKey(projectId, fingerprint) {
    return `${projectId}\u0000${fingerprint}`;
}
/**
 * Canonical ordering of group aggregates: `(project_id, fingerprint)`.
 *
 * Must match the `ORDER BY g.project_id, g.fingerprint` used by the locking
 * SELECTs so the JS-side emitted VALUES order and the SQL-side lock order agree.
 * Plain lexicographic comparison is correct and sufficient here — both columns
 * are ASCII (UUID text and a hex sha256 digest), so there is no collation
 * subtlety to reconcile with PostgreSQL's ordering.
 */
function compareAggregate(left, right) {
    if (left.projectId !== right.projectId)
        return left.projectId < right.projectId ? -1 : 1;
    if (left.fingerprint !== right.fingerprint)
        return left.fingerprint < right.fingerprint ? -1 : 1;
    return 0;
}
function isNewerItem(left, right) {
    const leftAt = left.occurredAt ?? new Date();
    const rightAt = right.occurredAt ?? new Date();
    return leftAt > rightAt || (leftAt.getTime() === rightAt.getTime() && left.eventId > right.eventId);
}
function isOlderItem(left, right) {
    const leftAt = left.occurredAt ?? new Date();
    const rightAt = right.occurredAt ?? new Date();
    return leftAt < rightAt || (leftAt.getTime() === rightAt.getTime() && left.eventId < right.eventId);
}
export class ErrorGroupRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async upsertGroupsBatch(client, items) {
        if (items.length === 0)
            return [];
        const aggregates = new Map();
        for (const item of items) {
            const organizationId = item.organizationId;
            if (!organizationId)
                throw new Error('ORGANIZATION_ID_REQUIRED');
            const key = groupKey(item.projectId, item.fingerprint);
            const severity = normalizeSeverity(item.severity);
            const existing = aggregates.get(key);
            if (!existing) {
                aggregates.set(key, {
                    key,
                    organizationId,
                    projectId: item.projectId,
                    fingerprint: item.fingerprint,
                    fingerprintVersion: item.fingerprintVersion ?? 2,
                    count: 1,
                    first: item,
                    latest: item,
                    highestSeverity: severity,
                    items: [item],
                });
                continue;
            }
            existing.count += 1;
            existing.items.push(item);
            if (isOlderItem(item, existing.first))
                existing.first = item;
            if (isNewerItem(item, existing.latest))
                existing.latest = item;
            if (severityRank(severity) > severityRank(existing.highestSeverity))
                existing.highestSeverity = severity;
        }
        // Deterministic aggregate order. `aggregates` is keyed insertion-ordered,
        // i.e. arbitrary batch arrival order, which made the row-lock acquisition
        // order below differ between concurrent workers. See the ORDER BY note on
        // the locking SELECT: sorting here keeps the emitted VALUES lists (lock
        // probe, INSERT, UPDATE) in one canonical order so the SQL and the JS agree.
        // Observably inert: results are returned keyed by `inputIndex`, the per-group
        // `isNew` marker is per-group, and regression selection sorts by inputIndex
        // within a group — none of them depend on aggregate ordering.
        const aggregateList = [...aggregates.values()].sort(compareAggregate);
        const keyValues = [];
        let keyParam = 1;
        const keyRows = aggregateList.map((group) => {
            keyValues.push(group.projectId, group.fingerprint);
            const row = `($${keyParam}::uuid, $${keyParam + 1})`;
            keyParam += 2;
            return row;
        });
        // DEADLOCK AVOIDANCE — the ORDER BY is load-bearing, not cosmetic.
        //
        // This statement takes a row lock on every already-existing group in the
        // batch. Two ingestion workers processing overlapping fingerprint sets
        // previously locked those rows in whatever order their own batch happened to
        // produce, which is the textbook recipe for a lock cycle: worker A holds
        // fingerprint X and wants Y while worker B holds Y and wants X. PostgreSQL
        // resolves that by killing one transaction with 40P01 (deadlock_detected),
        // which `failureReason()` classifies as retryable — so under concurrent load
        // on hot fingerprints the tier burned capacity on deadlock-retry churn.
        //
        // PostgreSQL places the LockRows node ABOVE the Sort node, so rows are locked
        // in sorted output order. Ordering by the group's natural key therefore gives
        // every worker in the fleet one global lock order, making a cycle impossible.
        // Cost is a sort over U (unique fingerprints in this batch), not N events.
        const existingRows = await client.query(`WITH input(project_id, fingerprint) AS (VALUES ${keyRows.join(', ')})
       SELECT g.*
         FROM error_groups g
         JOIN input i ON i.project_id = g.project_id AND i.fingerprint = g.fingerprint
        ORDER BY g.project_id, g.fingerprint
        FOR UPDATE OF g`, keyValues);
        const existingByKey = await this.resolveEffectiveGroupsBatch(client, existingRows.rows);
        const createdKeys = new Set();
        const newGroups = aggregateList.filter((group) => !existingByKey.has(group.key));
        if (newGroups.length > 0) {
            const values = [];
            let param = 1;
            const rows = newGroups.map((group) => {
                const firstAt = group.first.occurredAt ?? new Date();
                const latestAt = group.latest.occurredAt ?? new Date();
                values.push(group.organizationId, group.projectId, group.fingerprint, group.fingerprintVersion, group.count, firstAt, latestAt, group.first.eventId, group.latest.eventId, group.highestSeverity, normalizeSeverity(group.latest.severity), group.latest.release ?? null, group.latest.sdkVersion ?? null, group.latest.applicationVersion ?? null, group.latest.environment ?? null, group.latest.service ?? null, group.latest.message ?? null, group.latest.errorName ?? null, group.latest.statusCode ?? null, group.latest.traceId ?? null, group.latest.requestId ?? null);
                const row = `($${param}::uuid, $${param + 1}::uuid, $${param + 2}, $${param + 3}::integer, 'OPEN', $${param + 4}::bigint, $${param + 5}::timestamptz, $${param + 6}::timestamptz, $${param + 6}::timestamptz, $${param + 7}, $${param + 8}, $${param + 9}, $${param + 10}, $${param + 11}, $${param + 12}, $${param + 13}, $${param + 14}, $${param + 15}, $${param + 16}, $${param + 17}, $${param + 18}::integer, $${param + 19}, $${param + 20}, 1)`;
                param += 21;
                return row;
            });
            const createdRows = await client.query(`INSERT INTO error_groups (
           organization_id, project_id, fingerprint, fingerprint_version, status,
           occurrence_count, first_seen_at, last_seen_at, latest_event_occurred_at,
           first_event_id, latest_event_id, highest_severity, latest_severity,
           latest_release, latest_sdk_version, latest_application_version,
           latest_environment, latest_service, last_error_message, last_error_name,
           last_status_code, last_trace_id, last_request_id, version
         ) VALUES ${rows.join(', ')}
         ON CONFLICT (project_id, fingerprint) DO NOTHING
         RETURNING project_id, fingerprint`, values);
            for (const row of createdRows.rows) {
                createdKeys.add(groupKey(row.project_id, row.fingerprint));
            }
            const racedGroups = newGroups.filter((group) => !createdKeys.has(group.key));
            if (racedGroups.length > 0) {
                const racedValues = [];
                let racedParam = 1;
                const racedRows = racedGroups.map((group) => {
                    racedValues.push(group.projectId, group.fingerprint);
                    const row = `($${racedParam}::uuid, $${racedParam + 1})`;
                    racedParam += 2;
                    return row;
                });
                // Same global lock ordering as the primary probe above — this path is
                // reached precisely BECAUSE another worker is writing the same groups,
                // so it is the most deadlock-prone statement in the batch.
                const racedExistingRows = await client.query(`WITH input(project_id, fingerprint) AS (VALUES ${racedRows.join(', ')})
           SELECT g.*
             FROM error_groups g
             JOIN input i ON i.project_id = g.project_id AND i.fingerprint = g.fingerprint
            ORDER BY g.project_id, g.fingerprint
            FOR UPDATE OF g`, racedValues);
                const racedResolved = await this.resolveEffectiveGroupsBatch(client, racedExistingRows.rows);
                for (const [k, v] of racedResolved)
                    existingByKey.set(k, v);
            }
        }
        const regressions = [];
        const existingGroups = aggregateList.filter((group) => existingByKey.has(group.key));
        if (existingGroups.length > 0) {
            const values = [];
            let param = 1;
            const rows = existingGroups.map((group) => {
                const existing = existingByKey.get(group.key);
                const occurredAt = group.latest.occurredAt ?? new Date();
                const isNewer = this.isNewer(occurredAt, group.latest.eventId, existing.latest_event_occurred_at ?? existing.last_seen_at ?? existing.created_at, existing.latest_event_id);
                const regressionCandidate = String(existing.status).toUpperCase() === 'RESOLVED' && existing.resolved_at instanceof Date
                    ? group.items
                        .filter((item) => {
                        const itemOccurredAt = item.occurredAt ?? new Date();
                        return itemOccurredAt > existing.resolved_at && isReleaseEligible(item.release, existing.resolved_release);
                    })
                        .sort((left, right) => left.inputIndex - right.inputIndex)[0]
                    : undefined;
                const regression = regressionCandidate !== undefined;
                const nextHighest = severityRank(group.highestSeverity) > severityRank(existing.highest_severity)
                    ? group.highestSeverity
                    : normalizeSeverity(existing.highest_severity);
                const nextRegressionCount = Number(existing.regression_count ?? 0) + (regression ? 1 : 0);
                if (regression) {
                    regressions.push({
                        key: group.key,
                        inputIndex: regressionCandidate.inputIndex,
                        eventId: regressionCandidate.eventId,
                        occurredAt: regressionCandidate.occurredAt ?? occurredAt,
                        release: regressionCandidate.release ?? null,
                        severity: normalizeSeverity(regressionCandidate.severity),
                        regressionCount: nextRegressionCount,
                    });
                }
                values.push(existing.id, group.projectId, regression ? 'OPEN' : String(existing.status).toUpperCase(), group.first.occurredAt ?? occurredAt, occurredAt, isNewer, group.latest.eventId, normalizeSeverity(group.latest.severity), nextHighest, group.latest.release ?? null, group.latest.sdkVersion ?? null, group.latest.applicationVersion ?? null, group.latest.environment ?? null, group.latest.service ?? null, group.latest.message ?? null, group.latest.errorName ?? null, group.latest.statusCode ?? null, group.latest.traceId ?? null, group.latest.requestId ?? null, regression, nextRegressionCount, group.count);
                const row = `($${param}::uuid, $${param + 1}::uuid, $${param + 2}, $${param + 3}::timestamptz, $${param + 4}::timestamptz, $${param + 5}::boolean, $${param + 6}, $${param + 7}, $${param + 8}, $${param + 9}, $${param + 10}, $${param + 11}, $${param + 12}, $${param + 13}, $${param + 14}, $${param + 15}, $${param + 16}::integer, $${param + 17}, $${param + 18}, $${param + 19}::boolean, $${param + 20}::integer, $${param + 21}::bigint)`;
                param += 22;
                return row;
            });
            await client.query(`UPDATE error_groups AS g
            SET status = v.status,
                occurrence_count = g.occurrence_count + v.occurrence_delta,
                first_seen_at = LEAST(g.first_seen_at, v.first_seen_at),
                last_seen_at = GREATEST(g.last_seen_at, v.last_seen_at),
                latest_event_occurred_at = CASE WHEN v.is_newer THEN v.last_seen_at ELSE g.latest_event_occurred_at END,
                latest_event_id = CASE WHEN v.is_newer THEN v.latest_event_id ELSE g.latest_event_id END,
                latest_severity = CASE WHEN v.is_newer THEN v.latest_severity ELSE g.latest_severity END,
                highest_severity = v.highest_severity,
                latest_release = CASE WHEN v.is_newer THEN v.latest_release ELSE g.latest_release END,
                latest_sdk_version = CASE WHEN v.is_newer THEN v.latest_sdk_version ELSE g.latest_sdk_version END,
                latest_application_version = CASE WHEN v.is_newer THEN v.latest_application_version ELSE g.latest_application_version END,
                latest_environment = CASE WHEN v.is_newer THEN v.latest_environment ELSE g.latest_environment END,
                latest_service = CASE WHEN v.is_newer THEN v.latest_service ELSE g.latest_service END,
                last_error_message = CASE WHEN v.is_newer THEN v.last_error_message ELSE g.last_error_message END,
                last_error_name = CASE WHEN v.is_newer THEN v.last_error_name ELSE g.last_error_name END,
                last_status_code = CASE WHEN v.is_newer THEN v.last_status_code ELSE g.last_status_code END,
                last_trace_id = CASE WHEN v.is_newer THEN v.last_trace_id ELSE g.last_trace_id END,
                last_request_id = CASE WHEN v.is_newer THEN v.last_request_id ELSE g.last_request_id END,
                is_regression = CASE WHEN v.is_regression THEN TRUE ELSE FALSE END,
                regression_count = v.regression_count,
                last_regressed_at = CASE WHEN v.is_regression THEN v.last_seen_at ELSE g.last_regressed_at END,
                resolved_at = CASE WHEN v.is_regression THEN NULL ELSE g.resolved_at END,
                resolved_release = CASE WHEN v.is_regression THEN NULL ELSE g.resolved_release END,
                version = g.version + 1,
                updated_at = NOW()
           FROM (VALUES ${rows.join(', ')}) AS v(
             id, project_id, status, first_seen_at, last_seen_at, is_newer,
             latest_event_id, latest_severity, highest_severity, latest_release,
             latest_sdk_version, latest_application_version, latest_environment,
             latest_service, last_error_message, last_error_name, last_status_code,
             last_trace_id, last_request_id, is_regression, regression_count,
             occurrence_delta
           )
          WHERE g.id = v.id AND g.project_id = v.project_id`, values);
        }
        const finalRows = await client.query(`WITH input(project_id, fingerprint) AS (VALUES ${keyRows.join(', ')})
       SELECT g.*
         FROM error_groups g
         JOIN input i ON i.project_id = g.project_id AND i.fingerprint = g.fingerprint`, keyValues);
        const finalByKey = await this.resolveEffectiveGroupsBatch(client, finalRows.rows);
        const regressionByInput = new Map(regressions.map((regression) => [regression.inputIndex, regression]));
        const createdGroups = newGroups.filter((group) => createdKeys.has(group.key));
        if (createdGroups.length > 0) {
            const values = [];
            let param = 1;
            const rows = createdGroups.map((group) => {
                const row = finalByKey.get(group.key);
                if (!row)
                    throw new Error('ERROR_GROUP_NOT_FOUND_AFTER_BATCH_UPSERT');
                values.push(row.id, 'CREATED', null, 'OPEN', group.first.eventId, group.latest.release ?? null, group.first.occurredAt ?? new Date(), 'first_event', null, JSON.stringify({ status: 'OPEN' }), '{}');
                const tuple = `($${param}::uuid, $${param + 1}, $${param + 2}, $${param + 3}, $${param + 4}, $${param + 5}, $${param + 6}::timestamptz, $${param + 7}, 'system', $${param + 8}::jsonb, $${param + 9}::jsonb, $${param + 10}::jsonb)`;
                param += 11;
                return tuple;
            });
            await client.query(`INSERT INTO error_group_history (
           group_id, action, previous_status, new_status, event_id, release,
           occurred_at, reason, actor_type, old_value, new_value, metadata
         ) VALUES ${rows.join(', ')}`, values);
        }
        const regressionRows = regressions
            .map((regression) => {
            const row = finalByKey.get(regression.key);
            return row ? { regression, row } : null;
        })
            .filter((row) => row !== null);
        if (regressionRows.length > 0) {
            const historyValues = [];
            let historyParam = 1;
            const historyRows = regressionRows.map(({ regression, row }) => {
                historyValues.push(row.id, 'REGRESSED', 'RESOLVED', 'OPEN', regression.eventId, regression.release, regression.occurredAt, 'qualifying_event_after_resolution', JSON.stringify({ status: 'RESOLVED' }), JSON.stringify({ status: 'OPEN' }), '{}');
                const tuple = `($${historyParam}::uuid, $${historyParam + 1}, $${historyParam + 2}, $${historyParam + 3}, $${historyParam + 4}, $${historyParam + 5}, $${historyParam + 6}::timestamptz, $${historyParam + 7}, 'system', $${historyParam + 8}::jsonb, $${historyParam + 9}::jsonb, $${historyParam + 10}::jsonb)`;
                historyParam += 11;
                return tuple;
            });
            await client.query(`INSERT INTO error_group_history (
           group_id, action, previous_status, new_status, event_id, release,
           occurred_at, reason, actor_type, old_value, new_value, metadata
         ) VALUES ${historyRows.join(', ')}`, historyValues);
            const outboxValues = [];
            let outboxParam = 1;
            const outboxRows = regressionRows.map(({ regression, row }) => {
                const attributes = {
                    schemaVersion: 1,
                    eventType: 'ErrorGroupRegressed',
                    errorGroupId: row.id,
                    organizationId: row.organization_id,
                    projectId: row.project_id,
                    fingerprint: row.fingerprint,
                    eventId: regression.eventId,
                    occurredAt: regression.occurredAt.toISOString(),
                    previousStatus: 'RESOLVED',
                    newStatus: 'OPEN',
                    release: regression.release,
                    severity: regression.severity,
                    regressionCount: regression.regressionCount,
                };
                outboxValues.push(row.organization_id, `error_group_regressed:${row.id}:${regression.eventId}`, row.project_id, row.latest_environment ?? null, regression.eventId, regression.severity, JSON.stringify(attributes), regression.occurredAt);
                const tuple = `($${outboxParam}::uuid, $${outboxParam + 1}, $${outboxParam + 2}::uuid, $${outboxParam + 3}, $${outboxParam + 4}, $${outboxParam + 5}::logdb_severity, $${outboxParam + 6}::jsonb, $${outboxParam + 7}::timestamptz)`;
                outboxParam += 8;
                return tuple;
            });
            await client.query(`WITH input(organization_id, idempotency_key, project_id, environment, event_id, severity, attributes, occurred_at) AS (
           VALUES ${outboxRows.join(', ')}
         ),
         reserved AS (
           INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
           SELECT 'error_group_regressed', organization_id, idempotency_key
             FROM input
           ON CONFLICT DO NOTHING
           RETURNING organization_id, idempotency_key
         )
         INSERT INTO telemetry_outbox (
           organization_id, project_id, environment, signal_kind, event_id,
           severity, fast_path, attributes, occurred_at
         )
         SELECT input.organization_id, input.project_id, input.environment, 'error_group_regressed',
                input.event_id, input.severity, TRUE, input.attributes, input.occurred_at
           FROM input
           JOIN reserved
             ON reserved.organization_id = input.organization_id
            AND reserved.idempotency_key = input.idempotency_key
         ON CONFLICT DO NOTHING`, outboxValues);
        }
        const creationMarker = new Set();
        return items.map((item) => {
            const key = groupKey(item.projectId, item.fingerprint);
            const row = finalByKey.get(key);
            if (!row)
                throw new Error('ERROR_GROUP_NOT_FOUND_AFTER_BATCH_UPSERT');
            const wasCreated = createdKeys.has(key) && !creationMarker.has(key);
            if (wasCreated)
                creationMarker.add(key);
            return {
                inputIndex: item.inputIndex,
                result: {
                    id: row.id,
                    isNew: wasCreated,
                    status: String(row.status).toUpperCase(),
                    isRegression: regressionByInput.has(item.inputIndex),
                    regressionCount: Number(row.regression_count ?? 0),
                },
            };
        });
    }
    async upsertGroup(client, params) {
        const organizationId = params.organizationId;
        if (!organizationId)
            throw new Error('ORGANIZATION_ID_REQUIRED');
        const occurredAt = params.occurredAt ?? new Date();
        const severity = normalizeSeverity(params.severity);
        const created = await client.query(`INSERT INTO error_groups (
         organization_id, project_id, fingerprint, fingerprint_version, status,
         occurrence_count, first_seen_at, last_seen_at, latest_event_occurred_at,
         first_event_id, latest_event_id, highest_severity, latest_severity,
         latest_release, latest_sdk_version, latest_application_version,
         latest_environment, latest_service, last_error_message, last_error_name,
         last_status_code, last_trace_id, last_request_id, version
       ) VALUES (
         $1, $2, $3, $4, 'OPEN', 1, $5, $5, $5,
         $6, $6, $7, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 1
       )
       ON CONFLICT (project_id, fingerprint) DO NOTHING
       RETURNING ${ERROR_GROUP_COLUMNS}`, [
            organizationId,
            params.projectId,
            params.fingerprint,
            params.fingerprintVersion ?? 2,
            occurredAt,
            params.eventId,
            severity,
            params.release ?? null,
            params.sdkVersion ?? null,
            params.applicationVersion ?? null,
            params.environment ?? null,
            params.service ?? null,
            params.message ?? null,
            params.errorName ?? null,
            params.statusCode ?? null,
            params.traceId ?? null,
            params.requestId ?? null,
        ]);
        if (created.rows[0]) {
            const group = created.rows[0];
            await this.insertHistory(client, {
                groupId: group.id,
                action: 'CREATED',
                previousStatus: null,
                newStatus: 'OPEN',
                eventId: params.eventId,
                release: params.release ?? null,
                occurredAt,
                reason: 'first_event',
            });
            return {
                id: group.id,
                isNew: true,
                status: 'OPEN',
                isRegression: false,
                regressionCount: 0,
            };
        }
        const source = await this.lockByFingerprint(client, params.projectId, params.fingerprint);
        if (!source)
            throw new Error('ERROR_GROUP_NOT_FOUND_AFTER_CONFLICT');
        const target = await this.resolveEffectiveGroup(client, source);
        const sourceIsRedirect = source.id !== target.id;
        if (sourceIsRedirect) {
            return this.updateExistingGroup(client, target, params, occurredAt, severity, true);
        }
        return this.updateExistingGroup(client, target, params, occurredAt, severity, false);
    }
    async updateExistingGroup(client, group, params, occurredAt, severity, mergedRedirect) {
        const currentStatus = String(group.status).toUpperCase();
        const currentOccurredAt = group.latest_event_occurred_at ?? group.last_seen_at ?? group.created_at;
        const isNewer = this.isNewer(occurredAt, params.eventId, currentOccurredAt, group.latest_event_id);
        const regression = !mergedRedirect
            && currentStatus === 'RESOLVED'
            && group.resolved_at instanceof Date
            && occurredAt > group.resolved_at
            && isReleaseEligible(params.release, group.resolved_release);
        const nextStatus = regression ? 'OPEN' : currentStatus;
        const nextHighest = severityRank(severity) > severityRank(group.highest_severity)
            ? severity
            : normalizeSeverity(group.highest_severity);
        const nextRegressionCount = Number(group.regression_count ?? 0) + (regression ? 1 : 0);
        await client.query(`UPDATE error_groups
          SET status = $1,
              occurrence_count = occurrence_count + 1,
              first_seen_at = LEAST(first_seen_at, $2),
              last_seen_at = GREATEST(last_seen_at, $2),
              latest_event_occurred_at = CASE WHEN $3 THEN $2 ELSE latest_event_occurred_at END,
              latest_event_id = CASE WHEN $3 THEN $4 ELSE latest_event_id END,
              latest_severity = CASE WHEN $3 THEN $5 ELSE latest_severity END,
              highest_severity = $6,
              latest_release = CASE WHEN $3 THEN $7 ELSE latest_release END,
              latest_sdk_version = CASE WHEN $3 THEN $8 ELSE latest_sdk_version END,
              latest_application_version = CASE WHEN $3 THEN $9 ELSE latest_application_version END,
              latest_environment = CASE WHEN $3 THEN $10 ELSE latest_environment END,
              latest_service = CASE WHEN $3 THEN $11 ELSE latest_service END,
              last_error_message = CASE WHEN $3 THEN $12 ELSE last_error_message END,
              last_error_name = CASE WHEN $3 THEN $13 ELSE last_error_name END,
              last_status_code = CASE WHEN $3 THEN $14 ELSE last_status_code END,
              last_trace_id = CASE WHEN $3 THEN $15 ELSE last_trace_id END,
              last_request_id = CASE WHEN $3 THEN $16 ELSE last_request_id END,
              is_regression = CASE WHEN $17 THEN TRUE ELSE FALSE END,
              regression_count = $18,
              last_regressed_at = CASE WHEN $17 THEN $2 ELSE last_regressed_at END,
              resolved_at = CASE WHEN $17 THEN NULL ELSE resolved_at END,
              resolved_release = CASE WHEN $17 THEN NULL ELSE resolved_release END,
              version = version + 1,
              updated_at = NOW()
        WHERE id = $19 AND project_id = $20`, [
            nextStatus,
            occurredAt,
            isNewer,
            params.eventId,
            severity,
            nextHighest,
            params.release ?? null,
            params.sdkVersion ?? null,
            params.applicationVersion ?? null,
            params.environment ?? null,
            params.service ?? null,
            params.message ?? null,
            params.errorName ?? null,
            params.statusCode ?? null,
            params.traceId ?? null,
            params.requestId ?? null,
            regression,
            nextRegressionCount,
            group.id,
            params.projectId,
        ]);
        if (regression) {
            await this.insertHistory(client, {
                groupId: group.id,
                action: 'REGRESSED',
                previousStatus: 'RESOLVED',
                newStatus: 'OPEN',
                eventId: params.eventId,
                release: params.release ?? null,
                occurredAt,
                reason: 'qualifying_event_after_resolution',
            });
            await this.insertRegressionOutbox(client, group, params, occurredAt, severity, nextRegressionCount);
        }
        return {
            id: group.id,
            isNew: false,
            status: nextStatus,
            isRegression: regression,
            regressionCount: nextRegressionCount,
        };
    }
    async lockByFingerprint(client, projectId, fingerprint) {
        const result = await client.query(`SELECT ${ERROR_GROUP_COLUMNS} FROM error_groups
        WHERE project_id = $1 AND fingerprint = $2
        FOR UPDATE`, [projectId, fingerprint]);
        return result.rows[0] ?? null;
    }
    async resolveEffectiveGroup(client, source) {
        let current = source;
        const visited = new Set();
        while (current.merged_into) {
            if (visited.has(current.id))
                throw new Error('ERROR_GROUP_MERGE_CYCLE');
            visited.add(current.id);
            const result = await client.query(`SELECT ${ERROR_GROUP_COLUMNS} FROM error_groups WHERE id = $1 FOR UPDATE`, [current.merged_into]);
            if (!result.rows[0])
                throw new Error('ERROR_GROUP_MERGE_TARGET_NOT_FOUND');
            current = result.rows[0];
        }
        return current;
    }
    async resolveEffectiveGroupsBatch(client, rows) {
        const directRows = rows.filter((r) => !r.merged_into);
        const mergedRows = rows.filter((r) => !!r.merged_into);
        const effectiveByGroupKey = new Map();
        for (const r of directRows) {
            effectiveByGroupKey.set(groupKey(r.project_id, r.fingerprint), r);
        }
        if (mergedRows.length === 0) {
            return effectiveByGroupKey;
        }
        const mergedIds = mergedRows.map((r) => r.id);
        const recursiveRes = await client.query(`WITH RECURSIVE merge_chain AS (
         SELECT id, project_id, fingerprint, merged_into, id AS root_id, 1 AS depth
           FROM error_groups
          WHERE id = ANY($1::uuid[])

         UNION ALL

         SELECT target.id, target.project_id, target.fingerprint, target.merged_into, mc.root_id, mc.depth + 1
           FROM error_groups target
           JOIN merge_chain mc ON mc.merged_into = target.id
          WHERE mc.depth < 10
       )
       SELECT DISTINCT ON (mc.root_id) ${ERROR_GROUP_QUALIFIED_COLUMNS}, mc.root_id
         FROM merge_chain mc
         JOIN error_groups g ON g.id = mc.id
        WHERE mc.merged_into IS NULL
        ORDER BY mc.root_id, mc.depth DESC
        FOR UPDATE OF g`, [mergedIds]);
        const terminalByRootId = new Map();
        for (const row of recursiveRes.rows) {
            terminalByRootId.set(row.root_id, row);
        }
        for (const source of mergedRows) {
            const terminal = terminalByRootId.get(source.id);
            if (terminal) {
                effectiveByGroupKey.set(groupKey(source.project_id, source.fingerprint), terminal);
            }
            else {
                effectiveByGroupKey.set(groupKey(source.project_id, source.fingerprint), source);
            }
        }
        return effectiveByGroupKey;
    }
    isNewer(incomingAt, incomingId, currentAt, currentId) {
        return incomingAt > currentAt || (incomingAt.getTime() === currentAt.getTime() && incomingId > currentId);
    }
    async insertHistory(client, params) {
        await client.query(`INSERT INTO error_group_history (
         group_id, action, previous_status, new_status, event_id, release,
         occurred_at, reason, actor_type, old_value, new_value, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'system', $9, $10, '{}'::jsonb)`, [
            params.groupId,
            params.action,
            params.previousStatus,
            params.newStatus,
            params.eventId,
            params.release,
            params.occurredAt,
            params.reason,
            params.previousStatus ? JSON.stringify({ status: params.previousStatus }) : null,
            params.newStatus ? JSON.stringify({ status: params.newStatus }) : null,
        ]);
    }
    async insertRegressionOutbox(client, group, params, occurredAt, severity, regressionCount) {
        const attributes = {
            schemaVersion: 1,
            eventType: 'ErrorGroupRegressed',
            errorGroupId: group.id,
            organizationId: group.organization_id,
            projectId: group.project_id,
            fingerprint: group.fingerprint,
            eventId: params.eventId,
            occurredAt: occurredAt.toISOString(),
            previousStatus: 'RESOLVED',
            newStatus: 'OPEN',
            release: params.release ?? null,
            severity,
            regressionCount,
        };
        const idempotencyKey = `error_group_regressed:${group.id}:${params.eventId}`;
        const reserved = await client.query(`INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
       VALUES ('error_group_regressed', $1, $2)
       ON CONFLICT DO NOTHING
       RETURNING idempotency_key`, [group.organization_id, idempotencyKey]);
        if (reserved.rowCount === 0)
            return;
        await client.query(`INSERT INTO telemetry_outbox (
         organization_id, project_id, environment, signal_kind, event_id,
         severity, fast_path, attributes, occurred_at
       ) VALUES ($1, $2, $3, 'error_group_regressed', $4, $5, TRUE, $6::jsonb, $7)
       ON CONFLICT DO NOTHING`, [
            group.organization_id,
            group.project_id,
            params.environment ?? group.latest_environment ?? null,
            params.eventId,
            severity,
            JSON.stringify(attributes),
            occurredAt,
        ]);
    }
    async findByFingerprint(projectId, fingerprint) {
        const result = await this.pool.query(`SELECT ${ERROR_GROUP_COLUMNS} FROM error_groups WHERE project_id = $1 AND fingerprint = $2`, [projectId, fingerprint]);
        return result.rows[0] ? this.mapToDomain(result.rows[0]) : null;
    }
    async resolve(client, projectId, id, release) {
        await client.query(`UPDATE error_groups
          SET status = 'RESOLVED', resolved_at = NOW(), resolved_release = COALESCE($3, latest_release),
              version = version + 1, updated_at = NOW()
        WHERE project_id = $1 AND id = $2`, [projectId, id, release ?? null]);
    }
    async ignore(client, projectId, id) {
        await this.updateStatus(client, projectId, id, 'IGNORED');
    }
    async reopen(client, projectId, id) {
        await this.updateStatus(client, projectId, id, 'OPEN');
    }
    async archive(client, projectId, id) {
        await this.updateStatus(client, projectId, id, 'ARCHIVED');
    }
    async updateStatus(client, projectId, id, status) {
        await client.query(`UPDATE error_groups
          SET status = $3,
              resolved_at = CASE WHEN $3 = 'RESOLVED' THEN resolved_at ELSE NULL END,
              resolved_release = CASE WHEN $3 = 'RESOLVED' THEN resolved_release ELSE NULL END,
              version = version + 1, updated_at = NOW()
        WHERE project_id = $1 AND id = $2`, [projectId, id, status]);
    }
    async assign(_client, _projectId, _id, _userId) { }
    mapToDomain(row) {
        return {
            id: row.id,
            publicId: row.public_id,
            organizationId: row.organization_id,
            projectId: row.project_id,
            fingerprint: row.fingerprint,
            fingerprintVersion: Number(row.fingerprint_version ?? 1),
            status: String(row.status).toUpperCase(),
            occurrenceCount: Number(row.occurrence_count),
            firstSeenAt: row.first_seen_at,
            lastSeenAt: row.last_seen_at,
            firstEventId: row.first_event_id,
            latestEventId: row.latest_event_id,
            latestEventOccurredAt: row.latest_event_occurred_at,
            highestSeverity: normalizeSeverity(row.highest_severity),
            latestSeverity: normalizeSeverity(row.latest_severity),
            regressionCount: Number(row.regression_count ?? 0),
            lastRegressedAt: row.last_regressed_at,
            latestRelease: row.latest_release,
            latestSdkVersion: row.latest_sdk_version,
            latestApplicationVersion: row.latest_application_version,
            latestEnvironment: row.latest_environment,
            latestService: row.latest_service,
            resolvedAt: row.resolved_at,
            resolvedRelease: row.resolved_release,
            lastErrorMessage: row.last_error_message,
            lastErrorName: row.last_error_name,
            lastStatusCode: row.last_status_code,
            lastTraceId: row.last_trace_id,
            lastRequestId: row.last_request_id,
            mergedInto: row.merged_into,
            isMerged: Boolean(row.is_merged),
            version: Number(row.version),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
//# sourceMappingURL=error-group.repository.js.map