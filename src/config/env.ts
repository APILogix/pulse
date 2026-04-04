import { z } from 'zod';
import { config } from 'dotenv';

config()

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.string().transform(Number).default(3000),
  HOST: z.string().default('0.0.0.0'),
  
  // Database
  DATABASE_URL: z.string(),
  CLICKHOUSE_URL: z.string().optional(),
  REDIS_URL: z.string(),
  
  // Security
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(32),
  CLERK_SECRET_KEY: z.string(),
  CLERK_PUBLISHABLE_KEY: z.string(),
  
  // AI
  OPENAI_API_KEY: z.string().optional(),
  
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;