import { z } from "zod";
import { config } from "dotenv";
config();
const envSchema = z.object({
    // Server
    NODE_ENV: z
        .enum(["development", "staging", "production"])
        .default("development"),
    PORT: z.string().transform(Number).default(3000),
    HOST: z.string().default("0.0.0.0"),
    // Database
    DATABASE_URL: z.string(),
    CLICKHOUSE_URL: z.string().optional(),
    REDIS_URL: z.string(),
    // =========================
    LOG_DB_PRIMARY: z
        .string()
        .url("LOG_DB_PRIMARY must be a valid PostgreSQL URL"),
    LOG_DB_REPLICA: z
        .string()
        .url("LOG_DB_REPLICA must be a valid PostgreSQL URL"),
    // =========================
    // POOL CONFIG
    // =========================
    LOG_POOL_MAX: z.coerce.number().int().min(1).max(200).default(50),
    LOG_POOL_MIN: z.coerce.number().int().min(0).max(50).default(10),
    // =========================
    // QUERY SETTINGS
    // =========================
    LOG_QUERY_TIMEOUT: z.coerce
        .number()
        .int()
        .min(1000)
        .max(120000)
        .default(30000),
    LOG_RETRIES: z.coerce.number().int().min(1).max(10).default(3),
    // Security
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    ENCRYPTION_KEY: z.string().length(32),
    CLERK_SECRET_KEY: z.string(),
    CLERK_PUBLISHABLE_KEY: z.string(),
    // AI
    OPENAI_API_KEY: z.string().optional(),
});
export const env = envSchema.parse(process.env);
//# sourceMappingURL=env.js.map