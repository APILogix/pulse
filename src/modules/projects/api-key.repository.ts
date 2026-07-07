import type { Pool, PoolClient } from "pg";
import { pool } from "../../config/database.js";
import type { ProjectApiKey } from "./types.js";
import { ProjectError } from "./utils.js";

type ApiKeyRow = {
  id: string;
  project_id: string;
  organization_id: string;
  key_prefix: string;
  key_hash: string;
  name: string | null;
  permissions: string[];
  last_used_at: Date | null;
  expires_at: Date | null;
  created_by: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
};

export class ApiKeyRepository {
  constructor(private readonly db: Pool = pool) {}

  async create(
    data: {
      projectId: string;
      organizationId: string;
      name: string;
      keyPrefix: string;
      keyHash: string;
      permissions: string[];
      createdBy: string;
      expiresAt: Date | null;
      status: string;
    },
    client?: PoolClient,
  ): Promise<ProjectApiKey> {
    const db = client ?? this.db;
    const result = await db.query<ApiKeyRow>(
      `INSERT INTO project_api_keys (
         project_id, organization_id, name, key_prefix, key_hash,
         scopes, created_by, expires_at, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.projectId,
        data.organizationId,
        data.name,
        data.keyPrefix,
        data.keyHash,
        data.permissions || [],
        data.createdBy,
        data.expiresAt,
        data.status,
      ],
    );

    return this.mapRow(result.rows[0]!);
  }

  async findByProjectId(
    projectId: string,
    client?: PoolClient,
  ): Promise<ProjectApiKey[]> {
    const db = client ?? this.db;
    const result = await db.query<ApiKeyRow>(
      `SELECT * FROM project_api_keys
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [projectId],
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  async findByPrefix(
    keyPrefix: string,
    client?: PoolClient,
  ): Promise<ProjectApiKey[]> {
    const db = client ?? this.db;
    const result = await db.query<ApiKeyRow>(
      `SELECT * FROM project_api_keys
       WHERE key_prefix = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW())`,
      [keyPrefix],
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  async revoke(
    id: string,
    projectId: string,
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? this.db;
    const result = await db.query(
      `UPDATE project_api_keys
       SET status = 'revoked', updated_at = NOW()
       WHERE id = $1 AND project_id = $2`,
      [id, projectId],
    );

    if (result.rowCount === 0) {
      throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
    }
  }

  async updateLastUsed(
    id: string,
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? this.db;
    await db.query(
      `UPDATE project_api_keys
       SET last_used_at = NOW()
       WHERE id = $1`,
      [id],
    );
  }

  private mapRow(row: ApiKeyRow): ProjectApiKey {
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
      status: expired && row.status === "active" ? "expired" : (row.status as any),
      createdBy: row.created_by,
      revokedAt: null,
      revokedBy: null,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as unknown as ProjectApiKey;
  }
}
