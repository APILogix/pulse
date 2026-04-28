import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";  // ✅ RENAMED
import sensible from "@fastify/sensible";
import underPressure from "@fastify/under-pressure";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { registerPlugins } from "./config/plugins.js";
import { registerAuthModule } from "./modules/auth/auth.module.js";
import { registerBillingModule } from "./modules/billing/billing.module.js";
import fastifyRawBody from "fastify-raw-body";
import registerOrganizationModule from "./modules/organization/organization.module.js";
import { registerProjectsModule } from "./modules/projects/projects.module.js";
import { ingestionModule } from "./modules/ingestion/ingestion.module.js";
import { registerAnalyticsModule } from "./modules/analytics/analytics.module.js";

declare module "fastify" {
  interface FastifyRequest {
    startTime: number;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,  // ✅ Use your logger instance
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
  app.withTypeProvider<ZodTypeProvider>();

  try {
    // Plugins - with individual error handling
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
      origin:true,
      credentials: true,
    });

    await app.register(compress);
    await app.register(cookie, { secret: env.JWT_SECRET });

    await app.register(fastifyRawBody, {
      field: "rawBody",
      global: false,
      encoding: "utf8",
      runFirst: true,
    });

    //  RENAMED to avoid conflict with your custom rateLimit middleware
    await app.register(fastifyRateLimit, {
      max: 100,
      timeWindow: "1 minute",
      keyGenerator: (req: FastifyRequest) => req.ip || "unknown",
      skipOnError: true,
      // Don't use Redis for now until it's fixed
    });

    await app.register(sensible);

    // Add error handling for these
    try {
      await app.register(registerPlugins);
      logger.info("Plugins registered successfully");
    } catch (err) {
      logger.error({ err }, "Failed to register plugins");
      throw err;
    }

    try {
      await app.register(registerAuthModule);
      logger.info("Auth module registered successfully");
    } catch (err) {
      logger.error({ err }, "Failed to register auth module");
      throw err;
    }

     try {
      await app.register(registerOrganizationModule);
      logger.info("Organization module registered successfully");
    } catch (err) {
      logger.error({ err }, "Failed to register organization module");
      throw err;
    }
    try {
      await app.register(registerBillingModule);
      logger.info("Billing module registered successfully");
    } catch (err) {
      logger.error({ err }, "Failed to register billing module");
      throw err;
    }
    try {
      await app.register(ingestionModule);
      logger.info("Ingestion module registered successfully");
    } catch (err) {
      logger.error({ err }, "Failed to register ingestion module");
      throw err;
    }

    try {
      await app.register(registerProjectsModule);
      logger.info("Projects module registered successfully");
    } catch (err) {
      logger.error({ err }, "Failed to register projects module");
      throw err;
    }

    try {
      await app.register(registerAnalyticsModule);
      logger.info("Analytics module registered successfully");
    } catch (err) {
      logger.error({ err }, "Failed to register analytics module");
      throw err;
    }

  } catch (pluginError) {
    logger.fatal({ pluginError }, "Failed to initialize plugins");
    throw pluginError;
  }

  // Error handler
  app.setErrorHandler((error: any, request, reply) => {
    const isDev = env.NODE_ENV === "development";

    // Log full error in dev
    if (isDev) {
      logger.error({
        err: error,
        validation: error.validation,
        stack: error.stack
      }, "Request error");
    }

    if (error.validation) {
      return reply.status(400).send({
        statusCode: 400,
        message: isDev ? error.message : "Validation failed",
        errors: error.validation,  // Add validation details
      });
    }

    // Handle specific Fastify errors
    if (error.code === 'FST_ERR_VALIDATION') {
      return reply.status(400).send({
        statusCode: 400,
        message: isDev ? error.message : "Invalid request",
      });
    }

    reply.status(error.statusCode || 500).send({
      statusCode: error.statusCode || 500,
      message: isDev ? error.message : "Internal Server Error",
      requestId: request.id,
      ...(isDev && { stack: error.stack }),  // Include stack in dev
    });
  });

  return app;
}
