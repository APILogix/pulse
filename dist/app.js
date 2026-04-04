import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import underPressure from "@fastify/under-pressure";
import { serializerCompiler, validatorCompiler, } from "fastify-type-provider-zod";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { register } from "node:module";
import { registerPlugins } from "./config/plugins.js";
export async function buildApp() {
    const app = Fastify({
        logger: false,
        trustProxy: true,
        genReqId: () => `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        connectionTimeout: 30000,
        keepAliveTimeout: 65000,
        maxRequestsPerSocket: 1000,
        bodyLimit: 10485760,
        routerOptions: {
            caseSensitive: false,
            ignoreTrailingSlash: true,
        },
        disableRequestLogging: false,
    });
    // Zod setup
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.withTypeProvider();
    //  Redis instance (FIXED import issue)
    //   const redis = new Redis(env.REDIS_URL)
    // Plugins
    await app.register(underPressure, {
        maxEventLoopDelay: 1000,
        maxHeapUsedBytes: 512 * 1024 * 1024,
        maxRssBytes: 1 * 1024 * 1024 * 1024,
        maxEventLoopUtilization: 0.98,
        pressureHandler: (req, rep, type) => {
            logger.warn({ type }, "Server under pressure");
            rep.status(503).send({ error: "Server busy", retryAfter: 10 });
        },
    });
    await app.register(helmet, {
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        hsts: env.NODE_ENV === "production" ? { maxAge: 31536000 } : false,
    });
    await app.register(cors, {
        origin: env.NODE_ENV === "development"
            ? ["http://localhost:3000", "http://localhost:5173"]
            : ["https://yourdomain.com"],
        credentials: true,
    });
    await app.register(compress);
    await app.register(rateLimit, {
        max: 100,
        timeWindow: "1 minute",
        // redis,
        keyGenerator: (req) => req.ip || "unknown",
        skipOnError: true,
    });
    await app.register(sensible);
    // all route plugins (including docs and health checks)
    app.register(registerPlugins);
    // Hooks
    //   app.addHook('onRequest', async (request) => {
    //     request.startTime = Date.now()
    //   })
    //   app.addHook('onResponse', async (request, reply) => {
    //     const duration = Date.now() - request.startTime
    //     request.log.info({
    //       statusCode: reply.statusCode,
    //       duration,
    //     })
    //     if (duration > 1000) {
    //       request.log.warn({ duration }, 'Slow request')
    //     }
    //   })
    //  Proper error typing
    app.setErrorHandler((error, request, reply) => {
        const isDev = env.NODE_ENV === "development";
        if (error.validation) {
            return reply.status(400).send({
                statusCode: 400,
                message: isDev ? error.message : "Validation failed",
            });
        }
        reply.status(error.statusCode || 500).send({
            statusCode: error.statusCode || 500,
            message: isDev ? error.message : "Internal Server Error",
            requestId: request.id,
        });
    });
    return app;
}
//# sourceMappingURL=app.js.map