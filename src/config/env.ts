import { z } from 'zod';
import { config } from 'dotenv';

config()

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.string().transform(Number).default(3000),
  HOST: z.string().default('0.0.0.0'),
  APP_NAME: z.string().default('Pulsiv'),
  APP_URL: z.string().url().default('http://localhost:5173'),
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
  LOG_POOL_MAX: z.coerce.number().int().min(1).max(500).default(20),
  LOG_POOL_MIN: z.coerce.number().int().min(0).max(500).default(5),
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

  // ClickHouse (Optional)
  CLICKHOUSE_URL: z.string().optional(),

  // Redis
  REDIS_URL: z.string(),

  // Security
  // JWT_SECRET signs short-lived access tokens. JWT_REFRESH_SECRET signs
  // refresh JWTs. COOKIE_SECRET signs the @fastify/cookie envelope. These
  // MUST be three distinct values so a leak in one does not compromise the
  // others. ENCRYPTION_KEY encrypts MFA TOTP secrets at rest.
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(32),
  CORS_ORIGINS: z.string().optional(),
  FRONTEND_URL: z.string().optional(),
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

  // AI
  OPENAI_API_KEY: z.string().optional(),

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
  INGESTION_DB_POOL_SIZE: z.coerce.number().int().min(2).max(200).default(20),
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
    env.ENCRYPTION_KEY,
  ]);
  if (distinct.size < 4) {
    throw new Error(
      'Auth misconfiguration: JWT_SECRET, JWT_REFRESH_SECRET, COOKIE_SECRET, and ENCRYPTION_KEY must each be unique.',
    );
  }
})();

export type Env = z.infer<typeof envSchema>;
