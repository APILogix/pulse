import { z } from 'zod';
import { config } from 'dotenv';

config()

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  // Threadpool size for crypto/DNS libuv offload. Default is 4, tune up to 8+ for heavy async scrypt loads.
  UV_THREADPOOL_SIZE: z.coerce.number().int().min(1).max(64).default(8),
  PORT: z.string().transform(Number).default(3000),
  HOST: z.string().default('0.0.0.0'),
  // Admission-control thresholds. Keep these below the process/container hard
  // limits so Fastify can shed load and recover instead of being OOM-killed.
  PRESSURE_MAX_EVENT_LOOP_DELAY_MS: z.coerce.number().int().min(50).default(1000),
  PRESSURE_MAX_EVENT_LOOP_UTILIZATION: z.coerce.number().min(0.5).max(1).default(0.95),
  PRESSURE_MAX_HEAP_MB: z.coerce.number().int().min(64).default(420),
  PRESSURE_MAX_RSS_MB: z.coerce.number().int().min(128).default(768),
  PRESSURE_LOG_INTERVAL_MS: z.coerce.number().int().min(1000).default(10_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(5000).default(20_000),
  APP_NAME: z.string().default('Pulsiv'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  BACKEND_URL: z.string().url().default('http://localhost:5000/api'),
  API_PUBLIC_URL: z.string().url().optional(),
  // Primary Database (PostgreSQL)
  DATABASE_URL: z.string(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_POOL_MIN: z.coerce.number().int().min(0).max(100).default(0),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(30000),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(30000),
  DB_QUERY_TIMEOUT_MS: z.coerce.number().int().min(0).default(0),
  DB_KEEPALIVE_INITIAL_DELAY_MS: z.coerce.number().int().min(0).default(10000),

  // Log Database (Primary + Replica)
  LOG_DB_PRIMARY: z.string().optional(),
  LOG_DB_REPLICA: z.string().optional(),
  LOG_POOL_MAX: z.coerce.number().int().min(1).max(500).default(10),
  // Do not pin warm log connections in every API replica while idle.
  LOG_POOL_MIN: z.coerce.number().int().min(0).max(500).default(0),
  // Read-path statement timeout (ms). Bounds runaway analytical reads.
  LOG_QUERY_TIMEOUT: z.coerce.number().int().min(0).default(30000),
  LOG_RETRIES: z.coerce.number().int().min(1).max(20).default(3),

  // ── Log DB resilience / timeout tuning ─────────────────────────────────
  // The ingestion log DB must NEVER abort large batch writes or background
  // maintenance under load. Writes therefore run with a separate (and by
  // default unbounded) statement timeout, while reads stay bounded.
  // 0 disables the statement timeout entirely for that path.
  LOG_DB_WRITE_TIMEOUT: z.coerce.number().int().min(0).default(0),
  LOG_DB_IDLE_TIMEOUT: z.coerce.number().int().min(0).default(30000),
  LOG_DB_CONNECTION_TIMEOUT: z.coerce.number().int().min(1000).default(10000),
  // Socket keepalive prevents managed providers (Neon/PgBouncer) from
  // silently dropping idle pooled connections mid-flight.
  LOG_DB_KEEPALIVE_MS: z.coerce.number().int().min(0).default(10000),
  LOG_DB_SLOW_QUERY_MS: z.coerce.number().int().min(1).default(1000),
  // Controls TLS for the dedicated log database. When unset, SSL is inferred
  // from the connection string (`sslmode=require|verify-*`) and otherwise disabled.
  LOG_DB_SSL_ENABLED: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return value === 'true';
    }),
  // Reject unauthorized TLS in production unless explicitly relaxed (some
  // managed providers serve certs that need this off).
  LOG_DB_SSL_REJECT_UNAUTHORIZED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),

  // ── Log DB TimescaleDB tuning ──────────────────────────────────────────
  // When enabled, connect() promotes the event tables to TimescaleDB
  // hypertables and installs compression + retention policies. Idempotent
  // and non-fatal: any failure degrades to plain PostgreSQL behaviour.
  LOG_DB_ENABLE_TIMESCALE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  LOG_DB_CHUNK_INTERVAL: z.string().default('1 day'),
  LOG_DB_COMPRESS_AFTER: z.string().default('7 days'),
  LOG_DB_RETENTION: z.string().default('90 days'),
  // Ingestion workers write into the dedicated Log DB event schema. Keep this
  // enabled so workers fail fast instead of processing jobs against stale/missing
  // Log DB tables. Set to false only when migrations are handled externally.
  LOG_DB_AUTO_MIGRATE: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),

  // ClickHouse (Optional)
  CLICKHOUSE_URL: z.string().optional(),

  // Redis
  REDIS_URL: z.string(),

  // Security
  // JWT_SECRET signs short-lived access tokens. JWT_REFRESH_SECRET signs
  // refresh JWTs. COOKIE_SECRET signs the @fastify/cookie envelope. These
  // MUST be three distinct values so a leak in one does not compromise the
  // others. ENCRYPTION_KEY encrypts MFA TOTP secrets at rest.
  // AUTH_TOKEN_SECRET is used for HMAC-SHA256 hashing of sensitive bearer
  // tokens (email verification, password reset, MFA OTPs) to prevent
  // timing attacks and rainbow-table brute-force.
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  AUTH_TOKEN_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(32),
  CORS_ORIGINS: z.string().optional(),
  FRONTEND_URL: z.string().url().optional(),
  ALLOWED_ORIGINS: z.string().default(''),

  // Email / SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM_EMAIL: z.string().email().default('security@example.com'),
  SMTP_FROM_NAME: z.string().default('pulsiv Security'),

  // Auth callbacks / SSO / WebAuthn
  OIDC_CALLBACK_URL: z.string().url().optional(),
  SOCIAL_LOGIN_CALLBACK_URL: z.string().url().optional(),
  SAML_SP_ENTITY_ID: z.string().url().optional(),
  SAML_SP_ACS_URL: z.string().url().optional(),
  SAML_SP_SLO_URL: z.string().url().optional(),
  SAML_SP_PRIVATE_KEY: z.string().optional(),
  SAML_SP_CERTIFICATE: z.string().optional(),
  SAML_ENFORCE_HTTPS: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),
  SAML_REQUIRE_SIGNED_ASSERTIONS: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),
  SAML_REQUIRE_SIGNED_RESPONSES: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),
  SAML_ACCEPTED_CLOCK_SKEW_MS: z.coerce.number().int().min(0).default(180_000),
  SAML_MAX_ASSERTION_AGE_MS: z.coerce.number().int().min(1_000).default(300_000),
  SAML_REQUEST_ID_TTL_MS: z.coerce.number().int().min(1_000).default(600_000),
  SAML_ASSERTION_REPLAY_TTL_MS: z.coerce.number().int().min(1_000).default(600_000),
  SCIM_TOKEN_GRACE_PERIOD_MINUTES: z.coerce.number().int().min(1).default(5),
  SCIM_DEFAULT_TOKEN_EXPIRY_DAYS: z.coerce.number().int().min(1).default(365),
  SAML_SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(24),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  WEBAUTHN_RP_ID: z.string().optional(),
  WEBAUTHN_RP_NAME: z.string().optional(),

  // Social OAuth / identity linking
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_REDIRECT_URI: z.string().url().optional(),

  // AI Reliability Assistant. Disabled by default so deployments fail closed
  // until both an explicit feature switch and provider credentials exist.
  AI_ENABLED: z.string().optional().transform((value) => value === 'true'),
  OPENAI_API_KEY: z.string().optional(),
  AI_PRIMARY_MODEL: z.string().min(1).default('gpt-4o-mini'),
  AI_FALLBACK_MODEL: z.string().min(1).default('gpt-4o'),
  AI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
  AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  AI_PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(5),
  AI_CIRCUIT_RESET_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().min(1_000).max(1_000_000).default(250_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(16_384).default(4_096),
  AI_MAX_RETRIEVAL_CHUNKS: z.coerce.number().int().min(0).max(20).default(8),
  AI_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86_400).default(3_600),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000).default(20),
  AI_MAX_CONCURRENT_JOBS_PER_TENANT: z.coerce.number().int().min(1).max(100).default(5),
  AI_MAX_CONCURRENT_CHAT_PER_TENANT: z.coerce.number().int().min(1).max(100).default(10),

  // ── Ingestion pipeline tunables ────────────────────────────────────────
  // These are intentionally env-driven: production tuning of batch caps,
  // backpressure thresholds, and rate-limit defaults must NOT require code
  // changes. All defaults are conservative and safe.
  INGESTION_MAX_BATCH_SIZE: z.coerce.number().int().min(1).max(10_000).default(1000),
  INGESTION_DEFAULT_RATE_PER_SECOND: z.coerce.number().int().min(1).default(1000),
  INGESTION_DEFAULT_RATE_PER_MINUTE: z.coerce.number().int().min(1).default(10_000),
  INGESTION_BACKPRESSURE_HIGH_WATER: z.coerce.number().int().min(1000).default(100_000),
  INGESTION_BACKPRESSURE_CRITICAL_WATER: z.coerce.number().int().min(1000).default(250_000),
  INGESTION_REPLAY_MAX_EVENTS: z.coerce.number().int().min(1).max(100_000).default(10_000),
  INGESTION_RATE_BUCKET_TTL_MS: z.coerce.number().int().min(60_000).default(300_000), // 5m
  INGESTION_RATE_BUCKET_SWEEP_MS: z.coerce.number().int().min(5_000).default(60_000),  // 1m
  INGESTION_ENDPOINT: z.string().url().optional(),

  // ── Connector Pipeline Tunables ────────────────────────────────────────
  CONNECTOR_SEND_CONCURRENCY: z.coerce.number().int().min(1).max(500).default(3),
  CONNECTOR_CONCURRENCY_SLACK: z.coerce.number().int().min(1).max(100).default(5),
  CONNECTOR_CONCURRENCY_EMAIL: z.coerce.number().int().min(1).max(100).default(10),
  CONNECTOR_CONCURRENCY_WEBHOOK: z.coerce.number().int().min(1).max(100).default(8),
  CONNECTOR_CONCURRENCY_DISCORD: z.coerce.number().int().min(1).max(100).default(5),
  CONNECTOR_CONCURRENCY_TEAMS: z.coerce.number().int().min(1).max(100).default(5),
  CONNECTOR_CONCURRENCY_PAGERDUTY: z.coerce.number().int().min(1).max(100).default(8),
  CONNECTOR_CONCURRENCY_SMS: z.coerce.number().int().min(1).max(100).default(3),
  CONNECTOR_SEND_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  CONNECTOR_SEND_EXPIRE_SECONDS: z.coerce.number().int().min(1).max(3600).default(45),
  CONNECTOR_RETRY_EXPIRE_SECONDS: z.coerce.number().int().min(1).max(3600).default(120),
  CONNECTOR_HEALTH_EXPIRE_SECONDS: z.coerce.number().int().min(1).max(3600).default(180),
  CONNECTOR_CLEANUP_EXPIRE_SECONDS: z.coerce.number().int().min(1).max(3600).default(600),
  CONNECTOR_SECRET_EXPIRE_SECONDS: z.coerce.number().int().min(1).max(3600).default(900),
  CONNECTOR_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),
  CONNECTOR_HTTP_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).default(3000),

  // ── Ingestion worker tier (v2) ─────────────────────────────────────────
  // General workers drain fast signals (error/message/request/span/metric/log/
  // cron_checkin); specialized workers isolate heavy signals (profile/replay/
  // trace) so a slow profile upload never starves error ingestion.
  INGESTION_GENERAL_WORKERS: z.coerce.number().int().min(1).max(64).default(4),
  INGESTION_GENERAL_CONCURRENCY: z.coerce.number().int().min(1).max(256).default(8),
  INGESTION_GENERAL_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(50),
  INGESTION_SPECIALIZED_WORKERS: z.coerce.number().int().min(0).max(64).default(2),
  INGESTION_SPECIALIZED_CONCURRENCY: z.coerce.number().int().min(1).max(256).default(4),
  INGESTION_SPECIALIZED_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(10),
  INGESTION_VISIBILITY_TIMEOUT_MS: z.coerce.number().int().min(1000).default(300_000),     // 5m
  INGESTION_SPECIALIZED_VISIBILITY_TIMEOUT_MS: z.coerce.number().int().min(1000).default(600_000), // 10m
  INGESTION_POLL_MS: z.coerce.number().int().min(1).max(10_000).default(25),
  INGESTION_IDLE_POLL_MS: z.coerce.number().int().min(10).max(60_000).default(500),
  INGESTION_DB_POOL_SIZE: z.coerce.number().int().min(2).max(200).default(8),
  INGESTION_DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
  INGESTION_DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(5_000),
  MAX_QUEUE_DEPTH: z.coerce.number().int().min(0).default(50_000),
  MAX_GAUGE_AGE_MS: z.coerce.number().int().min(1000).default(10_000),
  GAUGE_UPDATE_INTERVAL_BATCHES: z.coerce.number().int().min(1).default(1),
  API_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(20),
  REDIS_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(100),
  INGESTION_RETRY_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),
  INGESTION_MAINTENANCE_INTERVAL_MS: z.coerce.number().int().min(60_000).default(6 * 60 * 60_000),
  INGESTION_COMPLETED_RETENTION_MS: z.coerce.number().int().min(60_000).default(60 * 60_000), // 1h

  // ── Usage counter (three-tier) ─────────────────────────────────────────
  INGESTION_USAGE_FLUSH_MS: z.coerce.number().int().min(1000).default(30_000),
  INGESTION_USAGE_BUFFER_LIMIT: z.coerce.number().int().min(100).default(10_000),

  // ── TimescaleDB logging database (operational metrics + audit) ─────────
  // Separate instance from the primary DB. When unset, the logging subsystem
  // degrades gracefully to no-ops (admin logs still land in the main DB).
  TIMESCALEDB_URL: z.string().optional(),
  INGESTION_LOG_DB_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(5),
  INGESTION_ADMIN_LOG_BUFFER_SIZE: z.coerce.number().int().min(10).default(100),
  INGESTION_ADMIN_LOG_FLUSH_MS: z.coerce.number().int().min(1000).default(5000),

  // ── Enterprise ingestion pipeline (pg-boss) ─────────────────────────────
  // Events per pg-boss job. Chunks bound job payload size and worker unit of
  // work; smaller = fairer scheduling, larger = fewer round trips.
  INGESTION_JOB_CHUNK_SIZE: z.coerce.number().int().min(10).max(1000).default(200),
  INGESTION_JOB_EXPIRE_SECONDS: z.coerce.number().int().min(30).default(300),
  INGESTION_JOB_RETRY_LIMIT: z.coerce.number().int().min(0).max(10).default(3),
  INGESTION_JOB_RETRY_DELAY_SECONDS: z.coerce.number().int().min(1).default(5),
  // Max decompressed body size for gzip ingestion payloads (zip-bomb guard).
  INGESTION_GZIP_MAX_BYTES: z.coerce.number().int().min(1024).default(20 * 1024 * 1024),
  // Organization-wide rate limits (noisy-neighbor protection at the gateway).
  INGESTION_ORG_RATE_LIMIT_PER_SECOND: z.coerce.number().int().min(1).default(5000),
  INGESTION_ORG_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(100_000),
  // TTL for the cached organization_usage_current_period quota read.
  INGESTION_QUOTA_CACHE_TTL_MS: z.coerce.number().int().min(1000).default(60_000),
  // Tenant fairness: how often a job may be deferred for exceeding the per-org
  // in-flight budget before aging forces it through (starvation guard).
  INGESTION_FAIRNESS_MAX_DEFERS: z.coerce.number().int().min(0).max(20).default(5),
  INGESTION_FAIRNESS_DEFER_DELAY_SECONDS: z.coerce.number().int().min(1).max(60).default(2),
  // Per-event-type worker concurrency (pg-boss localConcurrency / batchSize).
  INGESTION_TYPE_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(256).default(8),
  INGESTION_TYPE_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(4),
  // Metrics HTTP endpoint exposed by worker processes.
  INGESTION_WORKER_METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9465),
  // Cron schedules (pg-boss) for the usage rollup and alert rule evaluator.
  INGESTION_USAGE_ROLLUP_CRON: z.string().default('* * * * *'),
  INGESTION_ALERT_EVAL_CRON: z.string().default('* * * * *'),

  // ── Alerting v2 rollout flags ───────────────────────────────────────────────
  // docs/alerting-redesign/07-migration-plan.md §7 (zero-downtime sequence).
  // Flags are read at boot, so a rollback is a restart — never a migration.
  //
  // ALERTING_V2_WRITE: when true, alerting/connector runtime writes are mirrored
  // into the typed *_v2 Log DB tables (Increment 1 creates them; Increment 5
  // begins dual-write). Legacy tables stay authoritative until ALERTING_V2_READ.
  // A v2 mirror failure is logged and MUST NOT fail the request.
  ALERTING_V2_WRITE: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  // ALERTING_V2_READ: when true, reads come from the typed *_v2 runtime tables.
  // Requires ALERTING_V2_WRITE plus a passing verification gate
  // (07-migration-plan.md §9). Defined here so Increment 1 ships the complete,
  // documented rollout switch rather than adding flags piecemeal later.
  ALERTING_V2_READ: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  // DEV-002 (docs/alerting-redesign/DEVIATIONS.md): the scheduled evaluators read telemetry
  // through an injected pool. When the telemetry pool differs from the control-plane pool,
  // repointing changes WHAT the evaluator can see, so firing is suppressed by default until
  // Increment 8's parity harness has run. Tri-state:
  //   'true'  → always dry-run (evaluate + log, never fire or auto-resolve)
  //   'false' → always fire (use only after parity validation)
  //   unset   → dry-run automatically IF the telemetry pool differs from the config pool,
  //             so single-database deployments keep their current behaviour exactly.
  ALERTING_EVAL_DRY_RUN: z.enum(['true', 'false']).optional(),

  // Boot assertion for ADR-0006: the alerting runtime pool MUST be able to see the
  // telemetry and v2 runtime tables. Converts audit finding B1 (evaluator querying a
  // database with no telemetry) from a silent failure into a startup crash. Only
  // disable for local bootstrap before Log DB migrations have been applied.
  ALERTING_RUNTIME_POOL_ASSERT: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),

  // ── Connector global guards (alerting redesign Increment 7) ─────────────
  CONNECTOR_GLOBAL_LIMITS: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  CONNECTOR_GLOBAL_LIMIT: z.coerce.number().int().min(1).default(60),
  CONNECTOR_GLOBAL_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  CONNECTOR_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).default(5),
  CONNECTOR_CIRCUIT_RESET_SECONDS: z.coerce.number().int().min(1).default(60),
  ESCALATION_V2: z.string().optional().transform((value) => value === 'true'),

  // ── Analytics engine (docs/analytics/00-architecture-overview.md §7) ────
  // Dedicated worker process that turns canonical Log DB telemetry into
  // dashboard rollups. Completely independent from ingestion: separate
  // process, separate pool, separate queues, read-only on events_*.
  ANALYTICS_ENGINE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),
  // Per-queue local concurrency for analytics domain workers.
  ANALYTICS_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  // Hard ceiling on rows a single worker run may fold into rollups. Bounds the
  // read pressure any one analytics batch can put on the Log DB.
  ANALYTICS_BATCH_MAX_ROWS: z.coerce.number().int().min(1000).max(5_000_000).default(50_000),
  // Maximum catch-up span per run. Large backlogs are consumed in slices so a
  // cold start cannot issue an unbounded scan.
  ANALYTICS_MAX_WINDOW_SPAN_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
  // Recompute lookback for late-arriving events. Buckets newer than
  // (now - grace) are recomputed on every pass.
  ANALYTICS_LATE_EVENT_GRACE_SECONDS: z.coerce.number().int().min(0).max(86_400).default(900),
  // Per-statement guard for analytics reads (0 disables).
  ANALYTICS_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
  // Dedicated Log DB pool for the analytics process. Kept small so analytics
  // reads can never starve the ingestion writer pool.
  ANALYTICS_DB_POOL_MAX: z.coerce.number().int().min(1).max(64).default(4),
  // Health + Prometheus endpoint exposed by the analytics worker process.
  ANALYTICS_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(9301),
  // Watermark lag beyond which API responses report meta.freshness.stale.
  ANALYTICS_FRESHNESS_STALE_SECONDS: z.coerce.number().int().min(30).default(300),
  // Analytics-owned retention pruning (never touches events_*).
  ANALYTICS_RETENTION_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),
  // Boot assertion that the analytics pool is attached to the database that
  // owns events_* — mirrors ALERTING_RUNTIME_POOL_ASSERT.
  ANALYTICS_POOL_ASSERT: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),
  // Per-bucket entity ceiling for Shape B rollups. Overflow is folded into a
  // single __other__ row so route/metric-name explosions stay bounded.
  ANALYTICS_ENTITY_TOPK: z.coerce.number().int().min(50).max(50_000).default(1_000),
  // Apdex satisfied threshold (ms). Tolerating zone is 4x this value.
  ANALYTICS_APDEX_THRESHOLD_MS: z.coerce.number().int().min(10).max(60_000).default(500),
  // Inactivity gap that closes a reconstructed session.
  ANALYTICS_SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
});

export const env = envSchema.parse(process.env);

// Defense-in-depth: refuse to boot if any two crypto secrets are identical.
// Reusing one secret across JWT signing, refresh-token signing, and cookie
// signing means a compromise in one subsystem trivially compromises the
// others. This guard catches misconfiguration during startup.
(function assertSecretsAreDistinct(): void {
  const distinct = new Set([
    env.JWT_SECRET,
    env.JWT_REFRESH_SECRET,
    env.COOKIE_SECRET,
    env.AUTH_TOKEN_SECRET,
    env.ENCRYPTION_KEY,
  ]);
  if (distinct.size < 5) {
    throw new Error(
      'Auth misconfiguration: JWT_SECRET, JWT_REFRESH_SECRET, COOKIE_SECRET, AUTH_TOKEN_SECRET, and ENCRYPTION_KEY must each be unique.',
    );
  }
})();

export type Env = z.infer<typeof envSchema>;
