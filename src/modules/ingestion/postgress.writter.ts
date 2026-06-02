/**
 * PostgresWriter — API key resolution + telemetry reads (delegates to TelemetryReader).
 * Persistence for the ingestion worker lives in TelemetryWriter, not here.
 */
import { type Pool } from 'pg';
import type {
  EnrichedEvent,
  ErrorEventListResult,
  ErrorEventRecord,
  NormalizedErrorEventListQuery,
} from './types.js';
import { TelemetryReader } from './pipeline/telemetry-reader.js';

export interface ProjectAuthResult {
  projectId: string;
  orgId: string;
  projectName: string;
  projectStatus: string;
  environment: string;
  apiKeyId: string;
  isActive: boolean;
  expiresAt: Date | null;
}

export class PostgresWriter {
  private readonly reader: TelemetryReader;

  constructor(public readonly pool: Pool) {
    this.reader = new TelemetryReader(pool);
  }

  async getProjectByApiKeyHash(keyHash: string): Promise<ProjectAuthResult | null> {
    const result = await this.pool.query(
      `
      SELECT
        p.id as project_id,
        p.org_id,
        p.name as project_name,
        p.status as project_status,
        k.environment,
        k.id as key_id,
        k.is_active,
        k.expires_at
      FROM project_api_keys k
      INNER JOIN projects p ON p.id = k.project_id
      WHERE k.key_hash = $1
        AND k.is_active = true
        AND (k.expires_at IS NULL OR k.expires_at > NOW())
        AND p.status = 'active'
      LIMIT 1
    `,
      [keyHash],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      projectId: row.project_id,
      orgId: row.org_id,
      projectName: row.project_name,
      projectStatus: row.project_status,
      environment: row.environment,
      apiKeyId: row.key_id,
      isActive: row.is_active,
      expiresAt: row.expires_at,
    };
  }

  async updateApiKeyLastUsed(apiKeyId: string): Promise<void> {
    await this.pool
      .query('UPDATE project_api_keys SET last_used_at = NOW() WHERE id = $1', [apiKeyId])
      .catch(() => {});
  }

  async listErrorEvents(query: NormalizedErrorEventListQuery): Promise<ErrorEventListResult> {
    return this.reader.listErrorEvents(query);
  }

  async getErrorEventById(errorId: string, projectId: string): Promise<ErrorEventRecord | null> {
    return this.reader.getErrorEventById(errorId, projectId);
  }

  async getEventById(eventId: string, projectId: string): Promise<unknown> {
    return this.reader.getEventById(eventId, projectId);
  }

  async getEventsForReplay(
    projectId: string,
    startTime: string,
    endTime: string,
    eventTypes?: string[],
    maxEvents = 10_000,
  ): Promise<EnrichedEvent[]> {
    return this.reader.getEventsForReplay(projectId, startTime, endTime, eventTypes, maxEvents);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
