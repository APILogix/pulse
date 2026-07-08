import { pool } from "../../config/database.js";
import { ProjectError } from "./utils.js";
export class ApiKeyRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async create(data, client) {
        const db = client ?? this.db;
        const result = await db.query(`INSERT INTO project_api_keys (
         project_id, organization_id, name, key_prefix, key_hash,
         scopes, created_by, expires_at, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`, [
            data.projectId,
            data.organizationId,
            data.name,
            data.keyPrefix,
            data.keyHash,
            data.permissions || [],
            data.createdBy,
            data.expiresAt,
            data.status,
        ]);
        return this.mapRow(result.rows[0]);
    }
    async findByProjectId(projectId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT * FROM project_api_keys
       WHERE project_id = $1
       ORDER BY created_at DESC`, [projectId]);
        return result.rows.map((row) => this.mapRow(row));
    }
    async findByPrefix(keyPrefix, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT * FROM project_api_keys
       WHERE key_prefix = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW())`, [keyPrefix]);
        return result.rows.map((row) => this.mapRow(row));
    }
    async revoke(id, projectId, client) {
        const db = client ?? this.db;
        const result = await db.query(`UPDATE project_api_keys
       SET status = 'revoked', updated_at = NOW()
       WHERE id = $1 AND project_id = $2`, [id, projectId]);
        if (result.rowCount === 0) {
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        }
    }
    async updateLastUsed(id, client) {
        const db = client ?? this.db;
        await db.query(`UPDATE project_api_keys
       SET last_used_at = NOW()
       WHERE id = $1`, [id]);
    }
    mapRow(row) {
        const expired = !!row.expires_at && row.expires_at.getTime() <= Date.now();
        return {
            id: row.id,
            projectId: row.project_id,
            orgId: row.organization_id,
            keyPrefix: row.key_prefix,
            environment: "production", // Not using environment in this new table
            name: row.name,
            description: null,
            permissions: row.permissions || [],
            isActive: row.status === "active" && !expired,
            status: expired && row.status === "active" ? "expired" : row.status,
            createdBy: row.created_by,
            revokedAt: null,
            revokedBy: null,
            expiresAt: row.expires_at,
            lastUsedAt: row.last_used_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
//# sourceMappingURL=api-key.repository.js.map