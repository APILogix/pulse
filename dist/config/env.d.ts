import { z } from "zod";
declare const envSchema: z.ZodObject<{
    NODE_ENV: z.ZodDefault<z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>>;
    PORT: z.ZodDefault<z.ZodPipe<z.ZodString, z.ZodTransform<number, string>>>;
    HOST: z.ZodDefault<z.ZodString>;
    DATABASE_URL: z.ZodString;
    CLICKHOUSE_URL: z.ZodOptional<z.ZodString>;
    REDIS_URL: z.ZodString;
    LOG_DB_PRIMARY: z.ZodString;
    LOG_DB_REPLICA: z.ZodString;
    LOG_POOL_MAX: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    LOG_POOL_MIN: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    LOG_QUERY_TIMEOUT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    LOG_RETRIES: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    JWT_SECRET: z.ZodString;
    JWT_REFRESH_SECRET: z.ZodString;
    ENCRYPTION_KEY: z.ZodString;
    CLERK_SECRET_KEY: z.ZodString;
    CLERK_PUBLISHABLE_KEY: z.ZodString;
    OPENAI_API_KEY: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const env: {
    NODE_ENV: "development" | "staging" | "production";
    PORT: number;
    HOST: string;
    DATABASE_URL: string;
    REDIS_URL: string;
    LOG_DB_PRIMARY: string;
    LOG_DB_REPLICA: string;
    LOG_POOL_MAX: number;
    LOG_POOL_MIN: number;
    LOG_QUERY_TIMEOUT: number;
    LOG_RETRIES: number;
    JWT_SECRET: string;
    JWT_REFRESH_SECRET: string;
    ENCRYPTION_KEY: string;
    CLERK_SECRET_KEY: string;
    CLERK_PUBLISHABLE_KEY: string;
    CLICKHOUSE_URL?: string | undefined;
    OPENAI_API_KEY?: string | undefined;
};
export type Env = z.infer<typeof envSchema>;
export {};
//# sourceMappingURL=env.d.ts.map