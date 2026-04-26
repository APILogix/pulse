import { z } from 'zod';
import { config } from 'dotenv';

config()

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.string().transform(Number).default(3000),
  HOST: z.string().default('0.0.0.0'),
  APP_NAME: z.string().default('API Monitoring'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Database
  DATABASE_URL: z.string(),
  CLICKHOUSE_URL: z.string().optional(),
  REDIS_URL: z.string(),

  // Security
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(32),
  CORS_ORIGINS: z.string().optional(),
  FRONTEND_URL: z.string().optional(),

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

export type Env = z.infer<typeof envSchema>;
