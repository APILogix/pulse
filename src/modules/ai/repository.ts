import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';

import { pool } from '../../config/database.js';
import { entitlementsService } from '../billing/entitlements/service.js';
import type { AIAnswer, AIMode, AIRequestInput, CreditRulesContext } from './types.js';
import { DEFAULT_CREDIT_COSTS } from './types.js';
import type { ModelRoute } from './openai-client.js';

export const MODE_FEATURE_KEYS: Record<AIMode, string> = {
  AI_ERROR_EXPLANATION: 'ai.enabled',
  AI_ROOT_CAUSE_ANALYSIS: 'ai.root_cause_analysis',
  AI_STACK_TRACE_ANALYSIS: 'ai.enabled',
  AI_TRACE_ANALYSIS: 'ai.enabled',
  AI_SPAN_ANALYSIS: 'ai.enabled',
  AI_SUGGESTED_FIXES: 'ai.enabled',
  AI_SQL_OPTIMIZATION: 'ai.enabled',
  AI_LOG_SUMMARY: 'ai.summaries',
  AI_DEPLOYMENT_CORRELATION: 'ai.enabled',
  AI_INCIDENT_SUMMARY: 'ai.summaries',
  AI_WEEKLY_REPORT: 'ai.forecasting',
};

export class AIRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: 'LOCKED' | 'INSUFFICIENT_CREDITS' | 'DUPLICATE_IN_PROGRESS' | 'IDEMPOTENCY_CONFLICT' | 'TOO_MANY_JOBS' | 'TOO_MANY_CHAT_REQUESTS' | 'INVALID_REQUEST' | 'NOT_FOUND',
  ) {
    super(message);
  }
}

export interface AIAuthorization {
  role: string;
  plan: string;
  entitled: boolean;
  monthlyCredits: number;
}

export interface CreditReservation {
  tenantId: string;
  requestId: string;
  idempotencyKey: string;
  mode: AIMode;
  amount: number;
  unlimited: boolean;
}

export interface ExistingResponse {
  answer: AIAnswer;
  responseId: string;
  inputHash: string;
  mode: AIMode;
}

export interface PreparedRequest {
  reservation: CreditReservation | null;
  duplicateResponse: ExistingResponse | null;
}

export interface PreparedJob {
  jobId: string;
  status: string;
  created: boolean;
}

export interface KnowledgeChunk {
  sourceId: string;
  sourceType: string;
  title: string;
  reference: string;
  content: string;
  accessLevel: string;
  version: number;
  score: number;
}

export interface AccessibleProject {
  id: string;
  name: string;
  slug: string;
  environment: string;
}

export interface StoredChatResponse {
  requestId: string;
  conversationId: string;
  response: Record<string, unknown>;
}

export interface PreparedChatRequest {
  requestId: string;
  conversationId: string;
  replay: StoredChatResponse | null;
}

export interface ChatToolCallRecord {
  invocationId: string;
  toolName: string;
  projectId: string | null;
  arguments: Record<string, unknown>;
  result: unknown;
  durationMs: number;
  status: 'success' | 'failed';
}

type Queryable = Pool | PoolClient;

export class AIRepository {
  constructor(private readonly db: Pool = pool) {}

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async authorizeFeature(tenantId: string, userId: string, featureKey: string): Promise<AIAuthorization> {
    const memberResult = await this.db.query<{
      role: string;
      plan: string;
    }>(
      `SELECT om.role, p.key AS plan
       FROM organization_members om
       JOIN organization_subscriptions s ON s.organization_id = om.org_id
         AND s.status IN ('trialing', 'active') AND s.deleted_at IS NULL
       JOIN plans p ON p.id = s.plan_id AND p.is_active = TRUE AND p.deleted_at IS NULL
       WHERE om.org_id = $1 AND om.user_id = $2 AND om.status = 'active'
       ORDER BY s.created_at DESC LIMIT 1`,
      [tenantId, userId],
    );
    const row = memberResult.rows[0];
    if (!row) throw new AIRepositoryError('Organization access or active subscription is required', 'LOCKED');

    const [moduleEnabled, featureEnabled, monthlyCredits] = await Promise.all([
      entitlementsService.getEffectiveBooleanFeature(tenantId, 'ai.enabled'),
      featureKey === 'ai.enabled' ? Promise.resolve(true) : entitlementsService.getEffectiveBooleanFeature(tenantId, featureKey),
      entitlementsService.getEffectiveIntegerFeature(tenantId, 'quota.ai_credits'),
    ]);

    return {
      role: row.role,
      plan: row.plan,
      entitled: moduleEnabled && featureEnabled,
      monthlyCredits,
    };
  }

  async authorize(tenantId: string, userId: string, mode: AIMode): Promise<AIAuthorization> {
    return this.authorizeFeature(tenantId, userId, MODE_FEATURE_KEYS[mode]);
  }

  async authorizeMonitoringChat(tenantId: string, userId: string): Promise<AIAuthorization> {
    return this.authorizeFeature(tenantId, userId, 'ai.incident_copilot');
  }

  async getAccessibleProjects(tenantId: string, userId: string, requestedProjectId?: string): Promise<AccessibleProject[]> {
    const result = await this.db.query<{
      id: string; name: string; slug: string; environment: string;
    }>(
      `SELECT p.id, p.name, p.slug, environment.slug AS environment
       FROM projects p
       JOIN project_members pm
         ON pm.project_id = p.id
        AND pm.organization_id = p.org_id
        AND pm.user_id = $2
        AND pm.status = 'active'
       JOIN LATERAL (
         SELECT e.slug
         FROM project_environments e
         WHERE e.project_id = p.id
           AND e.organization_id = p.org_id
           AND e.is_active = TRUE
           AND e.deleted_at IS NULL
         ORDER BY e.is_default DESC, e.created_at ASC, e.id ASC
         LIMIT 1
       ) environment ON TRUE
       WHERE p.org_id = $1 AND p.status = 'active' AND p.deleted_at IS NULL
         AND ($3::uuid IS NULL OR p.id = $3)
       ORDER BY p.created_at DESC LIMIT 25`,
      [tenantId, userId, requestedProjectId ?? null],
    );
    if (requestedProjectId && result.rows.length === 0) {
      throw new AIRepositoryError('Project not found or not accessible', 'NOT_FOUND');
    }
    return result.rows.map((row) => ({
      id: row.id, name: row.name, slug: row.slug, environment: row.environment,
    }));
  }

  async resolveCreditRules(tenantId: string, plan: string, mode: AIMode): Promise<CreditRulesContext> {
    const result = await this.db.query<{ cost: number; cached_cost: number; partial_cost: number }>(
      `SELECT cost, cached_cost, partial_cost
       FROM credit_rules
       WHERE ai_mode = $1 AND status = 'active'
         AND effective_from <= NOW() AND (effective_to IS NULL OR effective_to > NOW())
         AND (scope = 'platform' OR (scope = 'plan' AND plan = $2)
              OR (scope = 'tenant' AND tenant_id = $3))
       ORDER BY CASE scope WHEN 'tenant' THEN 3 WHEN 'plan' THEN 2 ELSE 1 END DESC,
                priority DESC, effective_from DESC LIMIT 1`,
      [mode, plan, tenantId],
    );
    const row = result.rows[0];
    return {
      costs: { ...DEFAULT_CREDIT_COSTS, [mode]: Number(row?.cost ?? DEFAULT_CREDIT_COSTS[mode]) },
      cachedCost: Number(row?.cached_cost ?? 0),
      partialCost: Number(row?.partial_cost ?? 0),
      chargePartial: Number(row?.partial_cost ?? 0) > 0,
    };
  }

  async resolveModelRoute(tenantId: string, plan: string, mode: AIMode, defaults: ModelRoute): Promise<ModelRoute> {
    const result = await this.db.query<{
      primary_model: string;
      fallback_model: string | null;
      temperature: string | number;
      max_tokens: number;
      timeout_ms: number;
    }>(
      `SELECT primary_model, fallback_model, temperature, max_tokens, timeout_ms
       FROM ai_model_routes
       WHERE ai_mode = $1 AND status = 'active'
         AND (plan IS NULL OR plan = $2) AND (tenant_id IS NULL OR tenant_id = $3)
       ORDER BY (tenant_id IS NOT NULL) DESC, (plan IS NOT NULL) DESC, priority DESC LIMIT 1`,
      [mode, plan, tenantId],
    );
    const row = result.rows[0];
    if (!row) return defaults;
    return {
      primaryModel: row.primary_model,
      fallbackModel: row.fallback_model,
      temperature: Number(row.temperature),
      maxTokens: row.max_tokens,
      timeoutMs: row.timeout_ms,
    };
  }

  async getCached(tenantId: string, cacheKey: string): Promise<AIAnswer | null> {
    const result = await this.db.query<{ answer: AIAnswer }>(
      `UPDATE ai_cache c SET hits = hits + 1
       FROM ai_responses r
       WHERE c.cache_key = $1 AND c.tenant_id = $2
         AND c.invalidated_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > NOW())
         AND r.response_id = c.response_id AND r.tenant_id = c.tenant_id
       RETURNING r.answer`,
      [cacheKey, tenantId],
    );
    return result.rows[0]?.answer ?? null;
  }

  async getExistingAnswer(tenantId: string, idempotencyKey: string): Promise<ExistingResponse | null> {
    const result = await this.db.query<{
      answer: AIAnswer;
      response_id: string;
      input_hash: string;
      ai_mode: AIMode;
    }>(
      `SELECT r.answer, r.response_id, q.input_hash, q.ai_mode FROM ai_requests q
       JOIN ai_responses r ON r.request_id = q.request_id AND r.tenant_id = q.tenant_id
       WHERE q.tenant_id = $1 AND q.idempotency_key = $2 LIMIT 1`,
      [tenantId, idempotencyKey],
    );
    const row = result.rows[0];
    return row ? {
      answer: row.answer,
      responseId: row.response_id,
      inputHash: row.input_hash,
      mode: row.ai_mode,
    } : null;
  }

  async prepareRequest(input: {
    tenantId: string;
    userId: string;
    requestId: string;
    idempotencyKey: string;
    mode: AIMode;
    inputHash: string;
    cacheKey: string;
    cost: number;
    monthlyCredits: number;
  }): Promise<PreparedRequest> {
    return this.transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO ai_requests
          (request_id, tenant_id, user_id, ai_mode, idempotency_key, input_hash, cache_key, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'PROCESSING')
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING request_id`,
        [input.requestId, input.tenantId, input.userId, input.mode, input.idempotencyKey, input.inputHash, input.cacheKey],
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query<{
          answer: AIAnswer | null;
          response_id: string | null;
          input_hash: string;
          ai_mode: AIMode;
        }>(
          `SELECT r.answer, r.response_id, q.input_hash, q.ai_mode FROM ai_requests q
           LEFT JOIN ai_responses r ON r.request_id = q.request_id AND r.tenant_id = q.tenant_id
           WHERE q.tenant_id = $1 AND q.idempotency_key = $2 LIMIT 1`,
          [input.tenantId, input.idempotencyKey],
        );
        const row = existing.rows[0];
        if (row && (row.input_hash !== input.inputHash || row.ai_mode !== input.mode)) {
          throw new AIRepositoryError('The Idempotency-Key was already used for a different AI request', 'IDEMPOTENCY_CONFLICT');
        }
        if (row?.answer && row.response_id) {
          return {
            reservation: null,
            duplicateResponse: {
              answer: row.answer,
              responseId: row.response_id,
              inputHash: row.input_hash,
              mode: row.ai_mode,
            },
          };
        }
        throw new AIRepositoryError('An identical AI request is already processing', 'DUPLICATE_IN_PROGRESS');
      }
      if (input.cost <= 0) return { reservation: null, duplicateResponse: null };

      const unlimited = input.monthlyCredits < 0;
      await client.query(
        `INSERT INTO credit_balances (owner_type, owner_id, balance, unlimited)
         VALUES ('organization', $1, $2, $3)
         ON CONFLICT (owner_type, owner_id) DO UPDATE
           SET unlimited = EXCLUDED.unlimited`,
        [input.tenantId, Math.max(0, input.monthlyCredits), unlimited],
      );
      const balance = await client.query<{ balance: string; reserved_credits: string; unlimited: boolean }>(
        `SELECT balance, reserved_credits, unlimited FROM credit_balances
         WHERE owner_type = 'organization' AND owner_id = $1 FOR UPDATE`,
        [input.tenantId],
      );
      const current = balance.rows[0];
      if (!current) throw new AIRepositoryError('AI credit balance is unavailable', 'INSUFFICIENT_CREDITS');
      const available = Number(current.balance) - Number(current.reserved_credits);
      if (!current.unlimited && available < input.cost) {
        await client.query(`UPDATE ai_requests SET status = 'INSUFFICIENT_CREDITS' WHERE request_id = $1`, [input.requestId]);
        throw new AIRepositoryError('Insufficient AI credits', 'INSUFFICIENT_CREDITS');
      }
      if (!current.unlimited) {
        await client.query(
          `UPDATE credit_balances SET reserved_credits = reserved_credits + $2, version = version + 1
           WHERE owner_type = 'organization' AND owner_id = $1`,
          [input.tenantId, input.cost],
        );
      }
      await client.query(
        `INSERT INTO credit_ledger
          (owner_type, owner_id, request_id, idempotency_key, ai_mode, amount, direction, reason, status, metadata)
         VALUES ('organization',$1,$2,$3,$4,$5,'debit','AI answer reservation','pending',$6)`,
        [input.tenantId, input.requestId, input.idempotencyKey, input.mode, input.cost, JSON.stringify({ unlimited: current.unlimited })],
      );
      return {
        duplicateResponse: null,
        reservation: {
          tenantId: input.tenantId, requestId: input.requestId, idempotencyKey: input.idempotencyKey,
          mode: input.mode, amount: input.cost, unlimited: current.unlimited,
        },
      };
    });
  }

  async adjustReservation(reservation: CreditReservation, newAmount: number): Promise<CreditReservation> {
    const boundedAmount = Math.max(0, Math.min(reservation.amount, newAmount));
    if (boundedAmount === reservation.amount) return reservation;
    await this.transaction(async (client) => {
      const ledger = await client.query<{ status: string }>(
        `SELECT status FROM credit_ledger
         WHERE idempotency_key=$1 AND owner_type='organization' AND owner_id=$2 FOR UPDATE`,
        [reservation.idempotencyKey, reservation.tenantId],
      );
      if (ledger.rows[0]?.status !== 'pending') throw new Error('Credit reservation is no longer pending');
      if (!reservation.unlimited) {
        await client.query(
          `UPDATE credit_balances SET reserved_credits=reserved_credits-$2,version=version+1
           WHERE owner_type='organization' AND owner_id=$1 AND reserved_credits >= $2`,
          [reservation.tenantId, reservation.amount - boundedAmount],
        );
      }
      await client.query(`SELECT set_config('ai.allow_ledger_mutation','on',true)`);
      await client.query(
        `UPDATE credit_ledger SET amount=$3,reason='Partial AI answer reservation adjusted'
         WHERE idempotency_key=$1 AND owner_type='organization' AND owner_id=$2`,
        [reservation.idempotencyKey, reservation.tenantId, boundedAmount],
      );
    });
    return { ...reservation, amount: boundedAmount };
  }

  async releaseReservation(reservation: CreditReservation, reason: string): Promise<void> {
    await this.transaction(async (client) => {
      const ledger = await client.query<{ status: string }>(
        `SELECT status FROM credit_ledger
         WHERE idempotency_key = $1 AND owner_type='organization' AND owner_id=$2 FOR UPDATE`,
        [reservation.idempotencyKey, reservation.tenantId],
      );
      if (ledger.rows[0]?.status !== 'pending') return;
      if (!reservation.unlimited) {
        await client.query(
          `UPDATE credit_balances
           SET reserved_credits = GREATEST(0, reserved_credits - $2), version = version + 1
           WHERE owner_type = 'organization' AND owner_id = $1`,
          [reservation.tenantId, reservation.amount],
        );
      }
      await client.query(`SELECT set_config('ai.allow_ledger_mutation', 'on', true)`);
      await client.query(
        `UPDATE credit_ledger SET status = 'failed', reason = $3
         WHERE idempotency_key = $1 AND owner_type='organization' AND owner_id=$2`,
        [reservation.idempotencyKey, reservation.tenantId, reason.slice(0, 500)],
      );
    });
  }

  async finalizeReservation(
    reservation: CreditReservation,
    usage: { provider: string; model: string; promptTokens: number; completionTokens: number; latencyMs: number },
  ): Promise<void> {
    await this.transaction(async (client) => {
      const ledger = await client.query<{ status: string }>(
        `SELECT status FROM credit_ledger
         WHERE idempotency_key = $1 AND owner_type='organization' AND owner_id=$2 FOR UPDATE`,
        [reservation.idempotencyKey, reservation.tenantId],
      );
      if (ledger.rows[0]?.status === 'completed') return;
      if (ledger.rows[0]?.status !== 'pending') throw new Error('Credit reservation is no longer pending');
      if (!reservation.unlimited) {
        const debited = await client.query(
          `UPDATE credit_balances
           SET balance = balance - $2, reserved_credits = reserved_credits - $2, version = version + 1
           WHERE owner_type = 'organization' AND owner_id = $1
             AND balance >= $2 AND reserved_credits >= $2`,
          [reservation.tenantId, reservation.amount],
        );
        if (debited.rowCount !== 1) throw new Error('Reserved AI credit balance invariant failed');
      }
      await client.query(`SELECT set_config('ai.allow_ledger_mutation', 'on', true)`);
      await client.query(
        `UPDATE credit_ledger SET status = 'completed', reason = 'Successful AI answer delivered'
         WHERE idempotency_key = $1 AND owner_type='organization' AND owner_id=$2`,
        [reservation.idempotencyKey, reservation.tenantId],
      );
      await client.query(
        `UPDATE organization_usage_current_period
         SET ai_credits_used = ai_credits_used + $2, last_ai_request_at = NOW(), updated_at = NOW()
         WHERE organization_id = $1`,
        [reservation.tenantId, reservation.unlimited ? 0 : reservation.amount],
      );
      await this.insertUsage(reservation, usage, client);
    });
  }

  private async claimUsage(
    tenantId: string,
    requestId: string,
    featureKey: string,
    db: Queryable,
  ): Promise<boolean> {
    const claimed = await db.query(
      `INSERT INTO ai_usage_receipts (tenant_id,request_id,feature_key)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING request_id`,
      [tenantId, requestId, featureKey],
    );
    return claimed.rowCount === 1;
  }

  private async insertUsage(
    reservation: CreditReservation,
    usage: { provider: string; model: string; promptTokens: number; completionTokens: number; latencyMs: number },
    db: Queryable,
  ): Promise<void> {
    const featureKey = MODE_FEATURE_KEYS[reservation.mode];
    if (!(await this.claimUsage(reservation.tenantId, reservation.requestId, featureKey, db))) return;
    await db.query(
      `INSERT INTO ai_usage_logs
        (organization_id, feature_key, provider, model, credits_used, prompt_tokens,
         completion_tokens, estimated_cost_usd, duration_ms, status, request_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,'success',$9,$10)`,
      [reservation.tenantId, featureKey, usage.provider, usage.model,
       reservation.unlimited ? 0 : reservation.amount, usage.promptTokens, usage.completionTokens,
       usage.latencyMs, reservation.requestId, JSON.stringify({ ai_mode: reservation.mode, unlimited: reservation.unlimited })],
    );
  }

  async recordSuccessfulUsage(input: {
    tenantId: string; userId: string; requestId: string; mode: AIMode; cached: boolean;
    usage: { provider: string; model: string; promptTokens: number; completionTokens: number; latencyMs: number };
  }): Promise<void> {
    await this.transaction(async (client) => {
      const featureKey = MODE_FEATURE_KEYS[input.mode];
      if (!(await this.claimUsage(input.tenantId, input.requestId, featureKey, client))) return;
      await client.query(
        `INSERT INTO ai_usage_logs
          (organization_id,user_id,feature_key,provider,model,credits_used,prompt_tokens,
           completion_tokens,estimated_cost_usd,duration_ms,status,request_id,metadata)
         VALUES ($1,$2,$3,$4,$5,0,$6,$7,0,$8,'success',$9,$10)`,
        [input.tenantId, input.userId, featureKey, input.usage.provider, input.usage.model,
         input.usage.promptTokens, input.usage.completionTokens, input.usage.latencyMs,
         input.requestId, JSON.stringify({ ai_mode: input.mode, cached: input.cached, unbilled: true })],
      );
    });
  }

  async persistAnswer(input: {
    tenantId: string;
    userId: string;
    requestId: string;
    answer: AIAnswer;
    cacheKey: string | null;
    cacheTtlSeconds: number;
    provider: string;
    model: string;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    promptVersion: string;
  }): Promise<string> {
    return this.transaction(async (client) => {
      await client.query(
        `UPDATE ai_requests SET model_route=$2, provider=$3, latency_ms=$4, prompt_tokens=$5,
          completion_tokens=$6, status=$7, confidence=$8 WHERE request_id=$1 AND tenant_id=$9`,
        [input.requestId, input.model, input.provider, input.latencyMs, input.promptTokens,
         input.completionTokens, input.answer.status, input.answer.confidence_score, input.tenantId],
      );
      const response = await client.query<{ response_id: string }>(
        `INSERT INTO ai_responses
          (request_id,tenant_id,user_id,ai_mode,answer,confidence,citations,credit_action,status,prompt_template_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING response_id`,
        [input.requestId, input.tenantId, input.userId, input.answer.ai_mode, JSON.stringify(input.answer),
         input.answer.confidence_score, JSON.stringify(input.answer.citations), JSON.stringify(input.answer.credit_action),
         input.answer.status, input.promptVersion],
      );
      const responseId = response.rows[0]!.response_id;
      if (input.cacheKey && input.answer.status === 'SUCCESS' && input.cacheTtlSeconds > 0) {
        await client.query(
          `INSERT INTO ai_cache (cache_key,tenant_id,ai_mode,response_id,ttl_seconds,etag,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW()+make_interval(secs=>$5))
           ON CONFLICT (cache_key) DO UPDATE SET response_id=EXCLUDED.response_id,
             ttl_seconds=EXCLUDED.ttl_seconds,etag=EXCLUDED.etag,created_at=NOW(),
             expires_at=EXCLUDED.expires_at,invalidated_at=NULL`,
          [input.cacheKey, input.tenantId, input.answer.ai_mode, responseId, input.cacheTtlSeconds, input.requestId],
        );
      }
      return responseId;
    });
  }

  async getKnowledgeVersion(tenantId: string): Promise<string> {
    const result = await this.db.query<{ version: string }>(
      `SELECT COALESCE(md5(string_agg(document_id::text||':'||version::text||':'||checksum,',' ORDER BY document_id)), 'none') AS version
       FROM knowledge_documents WHERE status='active' AND (tenant_id=$1 OR tenant_id IS NULL)`,
      [tenantId],
    );
    return result.rows[0]?.version ?? 'none';
  }

  async retrieveKnowledge(input: {
    tenantId: string;
    role: string;
    query: string;
    embedding: number[] | null;
    limit: number;
    serviceName?: string;
    environmentName?: string;
    severity?: string;
    includeGlobal?: boolean;
  }): Promise<KnowledgeChunk[]> {
    if (input.limit <= 0 || !input.query.trim()) return [];
    const vector = input.embedding ? `[${input.embedding.join(',')}]` : null;
    const result = await this.db.query<{
      source_id: string; source_type: string; title: string; uri: string | null;
      content_summary: string; access_level: string; version: number; score: number | string;
    }>(
      `SELECT d.document_id::text AS source_id, d.source_type, d.title, d.uri,
              c.content_summary,
              COALESCE(c.access_control->>'level',d.access_control->>'level','tenant') AS access_level,
              d.version,
              (CASE WHEN $4::text IS NULL OR c.embedding IS NULL THEN 0
                    ELSE 1 - (c.embedding <=> $4::vector) END) * 0.60
              + ts_rank_cd(c.search_vector, websearch_to_tsquery('simple',$3)) * 0.25
              + (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW()-d.updated_at))/86400.0)) * 0.10
              + c.confidence_weight * 0.05 AS score
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.document_id = c.document_id
       WHERE d.status='active' AND (d.tenant_id=$1 OR ($9::boolean AND d.tenant_id IS NULL))
         AND (c.tenant_id=$1 OR ($9::boolean AND c.tenant_id IS NULL))
         AND (d.access_control = '{}'::jsonb
              OR NOT (d.access_control ? 'roles')
              OR (d.access_control->'roles') ? $2)
         AND (c.access_control = '{}'::jsonb
              OR NOT (c.access_control ? 'roles')
              OR (c.access_control->'roles') ? $2)
         AND ($6::text IS NULL OR cardinality(d.service_tags)=0 OR $6=ANY(d.service_tags))
         AND ($7::text IS NULL OR cardinality(d.environment_tags)=0 OR $7=ANY(d.environment_tags))
         AND ($8::text IS NULL OR NOT (c.tags ? 'severity') OR c.tags->>'severity'=$8)
         AND (c.search_vector @@ websearch_to_tsquery('simple',$3)
              OR ($4::text IS NOT NULL AND c.embedding IS NOT NULL))
       ORDER BY score DESC, d.updated_at DESC LIMIT $5`,
      [input.tenantId, input.role, input.query.slice(0, 2_000), vector, input.limit,
       input.serviceName ?? null, input.environmentName ?? null, input.severity ?? null,
       input.includeGlobal ?? true],
    );
    const seen = new Set<string>();
    return result.rows.flatMap((row) => {
      const score = Number(row.score);
      const dedupeKey = `${row.source_id}:${row.content_summary}`;
      if (!Number.isFinite(score) || score < 0.15 || seen.has(dedupeKey)) return [];
      seen.add(dedupeKey);
      return [{
        sourceId: row.source_id,
        sourceType: row.source_type,
        title: row.title,
        reference: row.uri ?? `knowledge://${row.source_id}`,
        content: row.content_summary,
        accessLevel: row.access_level,
        version: row.version,
        score,
      }];
    });
  }

  async prepareChatRequest(input: {
    tenantId: string;
    userId: string;
    idempotencyKey: string;
    inputHash: string;
    question: string;
    conversationId?: string;
    projectId?: string;
    maxConcurrentRequests: number;
  }): Promise<PreparedChatRequest> {
    const requestId = randomUUID();
    return this.transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`ai-chat:${input.tenantId}`]);
      const existing = await client.query<{
        request_id: string; conversation_id: string; input_hash: string;
        response: Record<string, unknown> | null; status: string;
      }>(
        `SELECT request_id,conversation_id,input_hash,response,status
         FROM ai_chat_requests WHERE tenant_id=$1 AND idempotency_key=$2 LIMIT 1`,
        [input.tenantId, input.idempotencyKey],
      );
      const duplicate = existing.rows[0];
      if (duplicate) {
        if (duplicate.input_hash !== input.inputHash) {
          throw new AIRepositoryError('The Idempotency-Key was already used for a different chat request', 'IDEMPOTENCY_CONFLICT');
        }
        if (!duplicate.response) {
          throw new AIRepositoryError('An identical chat request is already processing', 'DUPLICATE_IN_PROGRESS');
        }
        return {
          requestId: duplicate.request_id,
          conversationId: duplicate.conversation_id,
          replay: {
            requestId: duplicate.request_id,
            conversationId: duplicate.conversation_id,
            response: duplicate.response,
          },
        };
      }

      const active = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ai_chat_requests
         WHERE tenant_id=$1 AND status='processing' AND created_at > NOW()-INTERVAL '2 minutes'`,
        [input.tenantId],
      );
      if (Number(active.rows[0]?.count ?? 0) >= input.maxConcurrentRequests) {
        throw new AIRepositoryError('The organization has reached its concurrent AI chat limit', 'TOO_MANY_CHAT_REQUESTS');
      }

      let conversationId = input.conversationId;
      if (conversationId) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [conversationId]);
        const conversation = await client.query(
          `SELECT conversation_id FROM ai_conversations
           WHERE conversation_id=$1 AND tenant_id=$2 AND user_id=$3 AND deleted_at IS NULL FOR UPDATE`,
          [conversationId, input.tenantId, input.userId],
        );
        if (conversation.rowCount !== 1) throw new AIRepositoryError('Chat conversation not found', 'NOT_FOUND');
      } else {
        conversationId = randomUUID();
        await client.query(
          `INSERT INTO ai_conversations (conversation_id,tenant_id,user_id,title)
           VALUES ($1,$2,$3,$4)`,
          [conversationId, input.tenantId, input.userId, input.question.slice(0, 160)],
        );
      }

      await client.query(
        `INSERT INTO ai_chat_requests
          (request_id,tenant_id,user_id,conversation_id,project_id,idempotency_key,input_hash,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'processing')`,
        [requestId, input.tenantId, input.userId, conversationId, input.projectId ?? null,
         input.idempotencyKey, input.inputHash],
      );
      await client.query(
        `INSERT INTO ai_conversation_messages
          (tenant_id,conversation_id,request_id,role,content)
         VALUES ($1,$2,$3,'user',$4)`,
        [input.tenantId, conversationId, requestId, input.question],
      );
      await client.query(
        `UPDATE ai_conversations SET updated_at=NOW() WHERE conversation_id=$1 AND tenant_id=$2`,
        [conversationId, input.tenantId],
      );
      return { requestId, conversationId, replay: null };
    });
  }

  async getChatHistory(tenantId: string, userId: string, conversationId: string): Promise<Array<{ role: string; content: string }>> {
    const result = await this.db.query<{ role: string; content: string }>(
      `SELECT role,content FROM (
         SELECT m.role,m.content,m.created_at
         FROM ai_conversation_messages m
         JOIN ai_conversations c ON c.conversation_id=m.conversation_id AND c.tenant_id=m.tenant_id
         WHERE m.tenant_id=$1 AND m.conversation_id=$2 AND c.user_id=$3 AND c.deleted_at IS NULL
         ORDER BY m.created_at DESC LIMIT 20
       ) history ORDER BY created_at ASC`,
      [tenantId, conversationId, userId],
    );
    return result.rows;
  }

  async recordChatToolCalls(tenantId: string, requestId: string, calls: ChatToolCallRecord[]): Promise<void> {
    if (calls.length === 0) return;
    await this.transaction(async (client) => {
      for (const call of calls.slice(0, 5)) {
        await client.query(
          `INSERT INTO ai_tool_calls
            (invocation_id,tenant_id,request_id,tool_name,project_id,arguments,result,duration_ms,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (invocation_id) DO NOTHING`,
          [call.invocationId, tenantId, requestId, call.toolName, call.projectId,
           JSON.stringify(call.arguments), JSON.stringify(call.result), call.durationMs, call.status],
        );
      }
    });
  }

  async completeChatRequest(input: {
    tenantId: string; userId: string; requestId: string; conversationId: string;
    response: Record<string, unknown>; assistantContent: string;
    provider: string; model: string; promptTokens: number; completionTokens: number; latencyMs: number;
  }): Promise<void> {
    await this.transaction(async (client) => {
      const completed = await client.query(
        `UPDATE ai_chat_requests SET status='success',response=$4,provider=$5,model=$6,
           prompt_tokens=$7,completion_tokens=$8,latency_ms=$9,completed_at=NOW()
         WHERE request_id=$1 AND tenant_id=$2 AND user_id=$3 AND status='processing'`,
        [input.requestId, input.tenantId, input.userId, JSON.stringify(input.response),
         input.provider, input.model, input.promptTokens, input.completionTokens, input.latencyMs],
      );
      if (completed.rowCount !== 1) throw new Error('Chat request is no longer processing');
      await client.query(
        `INSERT INTO ai_conversation_messages
          (tenant_id,conversation_id,request_id,role,content,citations)
         VALUES ($1,$2,$3,'assistant',$4,$5)`,
        [input.tenantId, input.conversationId, input.requestId, input.assistantContent,
         JSON.stringify(input.response.citations ?? [])],
      );
      await client.query(
        `UPDATE ai_conversations SET updated_at=NOW() WHERE conversation_id=$1 AND tenant_id=$2`,
        [input.conversationId, input.tenantId],
      );
    });
  }

  async failChatRequest(tenantId: string, requestId: string, response: Record<string, unknown>): Promise<void> {
    await this.transaction(async (client) => {
      const failed = await client.query<{ conversation_id: string }>(
        `UPDATE ai_chat_requests SET status='failed',response=$3,completed_at=NOW()
         WHERE request_id=$1 AND tenant_id=$2 AND status='processing'
         RETURNING conversation_id`,
        [requestId, tenantId, JSON.stringify(response)],
      );
      const conversationId = failed.rows[0]?.conversation_id;
      if (!conversationId) return;
      await client.query(
        `INSERT INTO ai_conversation_messages
          (tenant_id,conversation_id,request_id,role,content,citations)
         VALUES ($1,$2,$3,'assistant',$4,'[]'::jsonb)
         ON CONFLICT (tenant_id,request_id,role) DO NOTHING`,
        [tenantId, conversationId, requestId, String(response.answer ?? '')],
      );
      await client.query(
        `UPDATE ai_conversations SET updated_at=NOW() WHERE conversation_id=$1 AND tenant_id=$2`,
        [conversationId, tenantId],
      );
    });
  }

  async confirmChatUsage(tenantId: string, requestId: string): Promise<boolean> {
    return this.transaction(async (client) => {
      const claimed = await client.query<{
        user_id: string; project_id: string | null; provider: string; model: string;
        prompt_tokens: number; completion_tokens: number; latency_ms: number;
      }>(
        `UPDATE ai_chat_requests SET usage_logged_at=NOW()
         WHERE request_id=$1 AND tenant_id=$2 AND status='success' AND usage_logged_at IS NULL
         RETURNING user_id,project_id,provider,model,prompt_tokens,completion_tokens,latency_ms`,
        [requestId, tenantId],
      );
      const row = claimed.rows[0];
      if (!row) return false;
      await client.query(
        `INSERT INTO ai_usage_logs
          (organization_id,project_id,user_id,feature_key,provider,model,credits_used,
           prompt_tokens,completion_tokens,estimated_cost_usd,duration_ms,status,request_id,metadata)
         VALUES ($1,$2,$3,'module_ai_insights_features_chat_assistant',$4,$5,0,$6,$7,0,$8,'success',$9,$10)`,
        [tenantId, row.project_id, row.user_id, row.provider, row.model,
         row.prompt_tokens, row.completion_tokens, row.latency_ms, requestId,
         JSON.stringify({ grounded: true })],
      );
      return true;
    });
  }

  async reconcilePendingChatUsage(limit = 100): Promise<number> {
    const pending = await this.db.query<{ tenant_id: string; request_id: string }>(
      `SELECT tenant_id,request_id FROM ai_chat_requests
       WHERE status='success' AND usage_logged_at IS NULL AND completed_at < NOW()-INTERVAL '1 minute'
       ORDER BY completed_at ASC LIMIT $1`,
      [Math.max(1, Math.min(limit, 500))],
    );
    let logged = 0;
    for (const item of pending.rows) {
      if (await this.confirmChatUsage(item.tenant_id, item.request_id)) logged += 1;
    }
    return logged;
  }

  async saveFeedback(input: {
    tenantId: string; userId: string; responseId: string;
    rating?: number; helpful?: boolean; correction?: string; comment?: string;
  }): Promise<string> {
    const result = await this.db.query<{ feedback_id: string }>(
      `INSERT INTO ai_feedback (request_id,response_id,tenant_id,user_id,rating,helpful,correction,comment)
       SELECT r.request_id,r.response_id,$1,$2,$4,$5,$6,$7 FROM ai_responses r
       WHERE r.response_id=$3 AND r.tenant_id=$1 AND r.user_id=$2 RETURNING feedback_id`,
      [input.tenantId, input.userId, input.responseId, input.rating ?? null, input.helpful ?? null,
       input.correction?.slice(0, 4_000) ?? null, input.comment?.slice(0, 4_000) ?? null],
    );
    const id = result.rows[0]?.feedback_id;
    if (!id) throw new AIRepositoryError('AI response not found', 'NOT_FOUND');
    return id;
  }

  async createJob(input: {
    tenantId: string;
    userId: string;
    mode: AIMode;
    inputHash: string;
    encryptedInput: string;
    idempotencyKey: string;
    maxConcurrentJobs: number;
  }): Promise<PreparedJob> {
    return this.transaction(async (client) => {
      // Serialize admission per tenant so parallel requests cannot exceed the
      // configured queued/running job cap.
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [input.tenantId]);
      const existing = await client.query<{
        job_id: string; status: string; user_id: string; ai_mode: AIMode; input_hash: string;
      }>(
        `SELECT job_id,status,user_id,ai_mode,input_hash FROM ai_jobs
         WHERE tenant_id=$1 AND idempotency_key=$2 LIMIT 1`,
        [input.tenantId, input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (row) {
        if (row.user_id !== input.userId || row.ai_mode !== input.mode || row.input_hash !== input.inputHash) {
          throw new AIRepositoryError('The Idempotency-Key was already used for a different AI job', 'IDEMPOTENCY_CONFLICT');
        }
        return { jobId: row.job_id, status: row.status, created: false };
      }

      const active = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ai_jobs
         WHERE tenant_id=$1 AND status IN ('queued','running')`,
        [input.tenantId],
      );
      if (Number(active.rows[0]?.count ?? 0) >= input.maxConcurrentJobs) {
        throw new AIRepositoryError('The organization has reached its concurrent AI job limit', 'TOO_MANY_JOBS');
      }

      const jobId = randomUUID();
      await client.query(
        `INSERT INTO ai_jobs
          (job_id,tenant_id,user_id,ai_mode,status,input_hash,input_ciphertext,idempotency_key)
         VALUES ($1,$2,$3,$4,'queued',$5,$6,$7)`,
        [jobId, input.tenantId, input.userId, input.mode, input.inputHash,
         input.encryptedInput, input.idempotencyKey],
      );
      return { jobId, status: 'queued', created: true };
    });
  }

  async attachQueueJob(jobId: string, tenantId: string, queueJobId: string): Promise<void> {
    await this.db.query(
      `UPDATE ai_jobs SET pgboss_job_id=$3 WHERE job_id=$1 AND tenant_id=$2 AND status='queued'`,
      [jobId, tenantId, queueJobId],
    );
  }

  async loadJob(jobId: string): Promise<{
    jobId: string; tenantId: string; userId: string; mode: AIMode; encryptedInput: string;
  } | null> {
    const result = await this.db.query<{
      job_id: string; tenant_id: string; user_id: string; ai_mode: AIMode; input_ciphertext: string;
    }>(
      `UPDATE ai_jobs SET status='running',started_at=NOW(),retry_count=retry_count+1
       WHERE job_id=$1 AND status IN ('queued','failed')
       RETURNING job_id,tenant_id,user_id,ai_mode,input_ciphertext`,
      [jobId],
    );
    const row = result.rows[0];
    return row ? {
      jobId: row.job_id, tenantId: row.tenant_id, userId: row.user_id,
      mode: row.ai_mode, encryptedInput: row.input_ciphertext,
    } : null;
  }

  async finishJob(jobId: string, responseId: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE ai_jobs j
       SET status='succeeded',finished_at=NOW(),error=NULL,response_id=$2,input_ciphertext=NULL,
           model_route=q.model_route
       FROM ai_responses r
       JOIN ai_requests q ON q.request_id=r.request_id AND q.tenant_id=r.tenant_id
       WHERE j.job_id=$1 AND r.response_id=$2 AND r.tenant_id=j.tenant_id`,
      [jobId, responseId],
    );
    if (result.rowCount !== 1) throw new Error('AI job response could not be attached');
  }

  async failJob(jobId: string, error: string): Promise<void> {
    await this.transaction(async (client) => {
      const failed = await client.query<{ tenant_id: string; user_id: string | null }>(
        `UPDATE ai_jobs SET status='failed',finished_at=NOW(),error=$2
         WHERE job_id=$1 RETURNING tenant_id,user_id`,
        [jobId, error.slice(0, 1_000)],
      );
      const job = failed.rows[0];
      if (!job) return;
      await client.query(
        `INSERT INTO organization_audit_logs
          (org_id,actor_user_id,action,entity_type,entity_id,request_id,status,is_sensitive,metadata)
         VALUES ($1,$2,'ai.job_failed','ai_job',$3,$3,'failure',TRUE,$4)`,
        [job.tenant_id, job.user_id, jobId, JSON.stringify({ error: error.slice(0, 500) })],
      );
    });
  }

  async getJob(tenantId: string, jobId: string, userId: string): Promise<Record<string, unknown> | null> {
    const result = await this.db.query(
      `SELECT j.job_id,j.ai_mode,j.status,j.started_at,j.finished_at,j.error,j.retry_count,j.response_id,
              r.answer FROM ai_jobs j LEFT JOIN ai_responses r ON r.response_id=j.response_id AND r.tenant_id=j.tenant_id
       WHERE j.job_id=$1 AND j.tenant_id=$2 AND j.user_id=$3`,
      [jobId, tenantId, userId],
    );
    return result.rows[0] ?? null;
  }

  async refundCredits(input: {
    tenantId: string;
    actorUserId: string;
    requestId: string;
    idempotencyKey: string;
    mode: AIMode;
    amount: number;
    reason: string;
  }): Promise<boolean> {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new Error('AI credit refund amount must be a positive safe integer');
    }
    return this.transaction(async (client) => {
      const result = await client.query<{ refunded: boolean }>(
        `SELECT ai_refund_credit($1,$2,$3,$4,$5,$6) AS refunded`,
        [input.tenantId, input.requestId, input.idempotencyKey, input.mode,
         input.amount, input.reason.slice(0, 500)],
      );
      const refunded = result.rows[0]?.refunded === true;
      if (refunded) {
        await client.query(
          `INSERT INTO organization_audit_logs
            (org_id,actor_user_id,action,entity_type,entity_id,request_id,status,is_sensitive,metadata)
           VALUES ($1,$2,'ai.credit_refunded','ai_request',$3,$3,'success',TRUE,$4)`,
          [input.tenantId, input.actorUserId, input.requestId,
           JSON.stringify({ mode: input.mode, amount: input.amount, reason: input.reason.slice(0, 500) })],
        );
      }
      return refunded;
    });
  }

  async releaseStaleReservations(): Promise<number> {
    const result = await this.db.query<{ released_count: number }>(`SELECT ai_release_stale_reservations() AS released_count`);
    return Number(result.rows[0]?.released_count ?? 0);
  }

  async markRequestFailed(requestId: string, tenantId: string, status: string): Promise<void> {
    await this.db.query(
      `UPDATE ai_requests SET status=$3 WHERE request_id=$1 AND tenant_id=$2`,
      [requestId, tenantId, status],
    );
  }

  async recordGovernanceEvent(input: {
    tenantId: string; userId: string; requestId: string; action: string;
    outcome: 'success' | 'failure'; metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO organization_audit_logs
        (org_id,actor_user_id,action,entity_type,entity_id,request_id,status,is_sensitive,metadata)
       VALUES ($1,$2,$3,'ai_request',$4,$4,$5,TRUE,$6)`,
      [input.tenantId, input.userId, input.action, input.requestId, input.outcome,
       JSON.stringify(input.metadata ?? {})],
    );
  }
}
