import { z } from 'zod';
import { config } from 'dotenv';

config()

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.string().transform(Number).default(3000),
  HOST: z.string().default('0.0.0.0'),
  APP_NAME: z.string().default('API Monitoring'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  // Primary Database (PostgreSQL)
  DATABASE_URL: z.string(),

  // Log Database (Primary + Replica)
  LOG_DB_PRIMARY: z.string().optional(),
  LOG_DB_REPLICA: z.string().optional(),
  LOG_POOL_MAX: z.string().transform(Number).default(20),
  LOG_POOL_MIN: z.string().transform(Number).default(5),
  LOG_QUERY_TIMEOUT: z.string().transform(Number).default(30000),
  LOG_RETRIES: z.string().transform(Number).default(3),

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
  SMTP_FROM_NAME: z.string().default('API Monitoring Security'),

  // AI
  OPENAI_API_KEY: z.string().optional(),

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
