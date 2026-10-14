/**
 * PostgreSQL adapter for the ConfigStore port.
 *
 * Backed by the existing `project_environment_sdk_configs` (head) and
 * `project_environment_sdk_config_revisions` (immutable revisions) tables. The
 * `compiled_snapshot` column is the sole authoritative store of the full
 * schema-v1 document; `requested_config` stores the editable intent. Revisions
 * are append-only (a DB trigger rejects UPDATE); publish/rollback advance the
 * head pointer under a `FOR UPDATE` row lock so revision numbers stay contiguous.
 *
 * NOTE: execution requires a live Postgres with migration
 * `019_upgrade_environment_sdk_config_snapshot` applied. This file is typechecked
 * and review-verified; behavioral verification is covered by the port's
 * in-memory unit tests and by integration tests when a database is available.
 */
import { v7 as uuidv7 } from "uuid";
import { pool } from "../../../config/database.js";
import { redisLookupCache } from "../../../db/redis/lookup-cache.js";
export class PgConfigStore {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async withTx(fn) {
        const client = await this.db.connect();
        try {
            await client.query("BEGIN");
            const result = await fn(client);
            await client.query("COMMIT");
            return result;
        }
        catch (error) {
            try {
                await client.query("ROLLBACK");
            }
            catch {
                // preserve original error
            }
            throw error;
        }
        finally {
            client.release();
        }
    }
    async loadCurrent(scope) {
        const headResult = await this.db.query(`SELECT current_revision, version AS draft_version
         FROM project_environment_sdk_configs
        WHERE organization_id = $1 AND environment_id = $2
        LIMIT 1`, [scope.organizationId, scope.environmentId]);
        const headRow = headResult.rows[0];
        if (!headRow)
            return null;
        const revResult = await this.db.query(`SELECT revision_number, requested_config, compiled_snapshot,
              config_hash AS canonical_sha256, change_type, rolled_back_to_revision
         FROM project_environment_sdk_config_revisions
        WHERE organization_id = $1 AND environment_id = $2 AND revision_number = $3
        LIMIT 1`, [scope.organizationId, scope.environmentId, headRow.current_revision]);
        const revRow = revResult.rows[0];
        if (!revRow)
            return null;
        return {
            head: {
                currentRevisionNo: headRow.current_revision,
                draftVersion: headRow.draft_version,
            },
            current: {
                revisionNo: revRow.revision_number,
                requestedConfig: revRow.requested_config,
                compiledSnapshot: revRow.compiled_snapshot,
                canonicalSha256: revRow.canonical_sha256,
                changeType: revRow.change_type,
                rolledBackToRevision: revRow.rolled_back_to_revision,
            },
        };
    }
    async loadRevision(scope, revisionNo) {
        const result = await this.db.query(`SELECT revision_number, requested_config, compiled_snapshot,
              config_hash AS canonical_sha256, change_type, rolled_back_to_revision
         FROM project_environment_sdk_config_revisions
        WHERE organization_id = $1 AND environment_id = $2 AND revision_number = $3
        LIMIT 1`, [scope.organizationId, scope.environmentId, revisionNo]);
        const row = result.rows[0];
        if (!row)
            return null;
        return {
            revisionNo: row.revision_number,
            requestedConfig: row.requested_config,
            compiledSnapshot: row.compiled_snapshot,
            canonicalSha256: row.canonical_sha256,
            changeType: row.change_type,
            rolledBackToRevision: row.rolled_back_to_revision,
        };
    }
    async appendRevision(scope, input) {
        const result = await this.withTx(async (client) => {
            // Row lock the head so concurrent publishes serialize cleanly
            const head = await client.query(`SELECT id, current_revision
           FROM project_environment_sdk_configs
          WHERE organization_id = $1 AND environment_id = $2
            FOR UPDATE`, [scope.organizationId, scope.environmentId]);
            if (!head.rows[0]) {
                throw new Error("SDK config head not found for environment");
            }
            const revisionNo = head.rows[0].current_revision + 1;
            const revisionId = uuidv7();
            const inserted = await client.query(`INSERT INTO project_environment_sdk_config_revisions(
           id, config_id, organization_id, project_id, environment_id, revision_number,
           requested_config, compiled_snapshot, config_hash, change_type,
           rolled_back_to_revision, published_by
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`, [
                revisionId,
                head.rows[0].id,
                scope.organizationId,
                scope.projectId,
                scope.environmentId,
                revisionNo,
                JSON.stringify(input.requestedConfig),
                JSON.stringify(input.compiledSnapshot),
                input.canonicalSha256,
                input.changeType,
                input.rolledBackToRevision,
                input.publishedBy,
            ]);
            await client.query(`UPDATE project_environment_sdk_configs
            SET published_revision_id = $3, current_revision = $4, current_hash = $5,
                schema_version = $6, updated_by = $7, version = version + 1, updated_at = NOW()
          WHERE organization_id = $1 AND environment_id = $2`, [
                scope.organizationId,
                scope.environmentId,
                inserted.rows[0].id,
                revisionNo,
                input.canonicalSha256,
                String(input.compiledSnapshot.schemaVersion),
                input.publishedBy,
            ]);
            return {
                head: { currentRevisionNo: revisionNo, draftVersion: 0 },
                revision: {
                    revisionNo,
                    requestedConfig: input.requestedConfig,
                    compiledSnapshot: input.compiledSnapshot,
                    canonicalSha256: input.canonicalSha256,
                    changeType: input.changeType,
                    rolledBackToRevision: input.rolledBackToRevision,
                },
            };
        });
        // Invalidate Redis caches on successful append
        void redisLookupCache.invalidateSdkConfig(scope.environmentId, scope.organizationId, scope.projectId, scope.environmentKey);
        void redisLookupCache.invalidateRemoteConfig(scope.projectId, scope.environmentKey);
        return result;
    }
    async initialize(scope, revision, createdBy) {
        const existing = await this.loadCurrent(scope);
        if (existing)
            return existing;
        const headId = uuidv7();
        const revisionId = uuidv7();
        await this.withTx(async (client) => {
            const head = await client.query(`INSERT INTO project_environment_sdk_configs(
           id, organization_id, project_id, environment_id, published_revision_id,
           current_revision, current_hash, schema_version, created_by, updated_by
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
         ON CONFLICT (organization_id, environment_id) DO NOTHING
         RETURNING id`, [
                headId,
                scope.organizationId,
                scope.projectId,
                scope.environmentId,
                revisionId,
                revision.revisionNo,
                revision.canonicalSha256,
                String(revision.compiledSnapshot.schemaVersion),
                createdBy,
            ]);
            if (!head.rows[0]?.id)
                return; // created concurrently; loadCurrent below resolves it
            await client.query(`INSERT INTO project_environment_sdk_config_revisions(
           id, config_id, organization_id, project_id, environment_id, revision_number,
           requested_config, compiled_snapshot, config_hash, change_type
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'initial')`, [
                revisionId,
                headId,
                scope.organizationId,
                scope.projectId,
                scope.environmentId,
                revision.revisionNo,
                JSON.stringify(revision.requestedConfig),
                JSON.stringify(revision.compiledSnapshot),
                revision.canonicalSha256,
            ]);
        });
        // Invalidate Redis caches on initialize
        void redisLookupCache.invalidateSdkConfig(scope.environmentId, scope.organizationId, scope.projectId, scope.environmentKey);
        void redisLookupCache.invalidateRemoteConfig(scope.projectId, scope.environmentKey);
        const created = await this.loadCurrent(scope);
        if (!created)
            throw new Error("Failed to initialize SDK config head");
        return created;
    }
    async loadCompiledByEnvironment(organizationId, environmentId) {
        // 1. Fast-Path: Check Redis Cache
        const cached = await redisLookupCache.getCompiledConfigByEnv(environmentId);
        if (cached) {
            return cached;
        }
        // 2. Slow-Path: Query PostgreSQL Database
        const result = await this.db.query(`SELECT r.revision_number, r.compiled_snapshot
         FROM project_environment_sdk_configs h
         JOIN project_environment_sdk_config_revisions r ON r.id = h.published_revision_id
         JOIN project_environments e
           ON e.id = h.environment_id AND e.project_id = h.project_id AND e.organization_id = h.organization_id
        WHERE h.organization_id = $1 AND h.environment_id = $2
          AND e.is_active = TRUE AND e.deleted_at IS NULL`, [organizationId, environmentId]);
        const row = result.rows[0];
        if (!row)
            return null;
        const data = {
            revisionNo: row.revision_number,
            compiledSnapshot: row.compiled_snapshot,
        };
        // Populate Redis cache asynchronously
        void redisLookupCache.setCompiledConfigByEnv(environmentId, data);
        return data;
    }
    async loadCompiledBySdkMetadata(organizationId, projectId, environment) {
        // 1. Fast-Path: Check Redis Cache
        const cached = await redisLookupCache.getCompiledConfigByMeta(organizationId, projectId, environment);
        if (cached) {
            return cached;
        }
        // 2. Slow-Path: Query PostgreSQL Database
        const result = await this.db.query(`SELECT r.revision_number, h.environment_id, r.compiled_snapshot
         FROM project_environment_sdk_configs h
         JOIN project_environment_sdk_config_revisions r ON r.id = h.published_revision_id
         JOIN projects p
           ON p.id = h.project_id AND p.org_id = h.organization_id
         JOIN project_environments e
           ON e.id = h.environment_id AND e.project_id = h.project_id AND e.organization_id = h.organization_id
        WHERE h.organization_id = $1
          AND h.project_id = $2
          AND e.slug = $3
          AND p.status = 'active' AND p.deleted_at IS NULL
          AND e.is_active = TRUE AND e.deleted_at IS NULL`, [organizationId, projectId, environment]);
        const row = result.rows[0];
        if (!row)
            return null;
        const data = {
            revisionNo: row.revision_number,
            environmentId: row.environment_id,
            compiledSnapshot: row.compiled_snapshot,
        };
        // Populate Redis cache asynchronously
        void redisLookupCache.setCompiledConfigByMeta(organizationId, projectId, environment, data);
        void redisLookupCache.setCompiledConfigByEnv(row.environment_id, {
            revisionNo: row.revision_number,
            compiledSnapshot: row.compiled_snapshot,
        });
        return data;
    }
}
//# sourceMappingURL=sdk-config.repository.js.map