import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type LegacyAlertingSource = 'project_alert_thresholds' | 'organization_alert_thresholds';
export type LegacyMappingStatus = 'pending' | 'mapped' | 'quarantined' | 'verified' | 'failed';

export interface LegacyAlertingMappingInput {
  organizationId: string;
  projectId: string | null;
  legacySource: LegacyAlertingSource;
  legacySourceId: string;
  sourceRevision: string | null;
  sourcePayload: Record<string, unknown>;
  canonicalRuleId?: string | null;
  canonicalBindingId?: string | null;
  status?: LegacyMappingStatus;
  error?: string | null;
  checkpoint?: string | null;
}

export class LegacyAlertingMapper {
  constructor(private readonly db: Pool) {}

  async record(input: LegacyAlertingMappingInput, client?: PoolClient): Promise<void> {
    const db = client ?? this.db;
    const sourceHash = createHash('sha256')
      .update(JSON.stringify(sortKeys(input.sourcePayload)))
      .digest('hex');
    await db.query(
      `INSERT INTO alerting_legacy_mappings (
         organization_id, project_id, legacy_source, legacy_source_id,
         canonical_rule_id, canonical_binding_id, source_revision, source_hash,
         mapping_status, mapping_error, checkpoint
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (legacy_source, legacy_source_id) DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         project_id = EXCLUDED.project_id,
         canonical_rule_id = EXCLUDED.canonical_rule_id,
         canonical_binding_id = EXCLUDED.canonical_binding_id,
         source_revision = EXCLUDED.source_revision,
         source_hash = EXCLUDED.source_hash,
         mapping_status = EXCLUDED.mapping_status,
         mapping_error = EXCLUDED.mapping_error,
         checkpoint = EXCLUDED.checkpoint,
         updated_at = NOW()`,
      [
        input.organizationId,
        input.projectId,
        input.legacySource,
        input.legacySourceId,
        input.canonicalRuleId ?? null,
        input.canonicalBindingId ?? null,
        input.sourceRevision,
        sourceHash,
        input.status ?? 'pending',
        input.error ?? null,
        input.checkpoint ?? null,
      ],
    );
  }

  async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortKeys(record[key])]));
}
