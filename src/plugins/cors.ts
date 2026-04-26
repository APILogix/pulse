import cors from "@fastify/cors";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";

const DEFAULT_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];

function getAllowedOrigins(): string[] {
  const configured = env.CORS_ORIGINS ?? env.FRONTEND_URL ?? "";
  const origins = configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length > 0) {
    return origins;
  }

  return env.NODE_ENV === "production" ? [] : DEFAULT_DEV_ORIGINS;
}

export const registerCors = fp(async function registerCors(app: FastifyInstance) {
  const allowedOrigins = getAllowedOrigins();

  await app.register(cors, {
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Accept", "X-Requested-With"],
    exposedHeaders: ["X-Request-Id"],
    maxAge: 86400,
    strictPreflight: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, origin);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
    },
  });
});
