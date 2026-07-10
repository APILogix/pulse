/**
 * Project utility functions.
 *
 * Flow:
 * - ProjectError + handleProjectError standardize every project/API-key
 *   failure envelope.
 * - Role helpers keep organization authorization comparisons consistent.
 * - Slug/prefix/API-key helpers generate stable public identifiers while only
 *   ever persisting the SHA-256 hash of a key.
 * - constantTimeEqualHex protects verification from timing leaks.
 *
 * Security: the raw API key exists only in the create/rotate response cycle.
 * We persist key_hash (sha256 hex) for verification and key_prefix for
 * candidate narrowing. Keys carry >= 24 bytes (48 hex chars) of entropy.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import type {
  ApiKeyType,
  OrgRole,
  ProjectEnvironment,
  ProjectStatus,
} from "../types.js";

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 100,
  admin: 80,
  developer: 60,
  security: 50,
  billing: 50,
  member: 40,
  viewer: 20,
};

// Status codes for every domain error the module raises. Centralized so routes
// and tests share one source of truth.
export const ProjectErrorCodes = {
  PROJECT_NOT_FOUND: 404,
  PROJECT_SLUG_EXISTS: 409,
  PROJECT_INVALID_TRANSITION: 400,
  PROJECT_LIMIT_EXCEEDED: 400,
  PROJECT_ARCHIVED: 409,
  INSUFFICIENT_PERMISSIONS: 403,
  ENVIRONMENT_NOT_FOUND: 404,
  ENVIRONMENT_EXISTS: 409,
  API_KEY_NOT_FOUND: 404,
  API_KEY_LIMIT_EXCEEDED: 400,
  API_KEY_REVOKED: 400,
  API_KEY_EXPIRED: 400,
  API_KEY_CONFLICT: 409,
  API_KEY_INVALID_STATE: 400,
  VALIDATION_ERROR: 422,
  INTERNAL_ERROR: 500,
} as const;

export class ProjectError extends Error {
  constructor(
    public readonly code: keyof typeof ProjectErrorCodes | string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ProjectError";
  }
}

function isHttpDomainError(error: unknown): error is Error & {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;
} {
  return error instanceof Error
    && typeof (error as { code?: unknown }).code === "string"
    && typeof (error as { statusCode?: unknown }).statusCode === "number";
}

export function handleProjectError(
  error: unknown,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof ProjectError) {
    return reply.code(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }

  if (isHttpDomainError(error)) {
    return reply.code(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }

  if (error instanceof ZodError) {
    return reply.code(422).send({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: error.flatten(),
      },
    });
  }

  return reply.code(500).send({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Unexpected project module error",
    },
  });
}

export function hasRequiredRole(role: OrgRole, requiredRole: OrgRole): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[requiredRole];
}

export function slugifyProjectName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return slug || `project-${randomBytes(3).toString("hex")}`;
}

/** Public prefix for keys minted in a given environment. */
export function environmentKeyPrefix(environment: ProjectEnvironment): string {
  switch (environment) {
    case "production":
      return "pk_live_";
    case "staging":
      return "pk_stg_";
    case "development":
    default:
      return "pk_dev_";
  }
}

export function buildApiPrefixes(): {
  productionApiPrefix: string;
  developmentApiPrefix: string;
  stagingApiPrefix: string;
} {
  return {
    productionApiPrefix: environmentKeyPrefix("production"),
    developmentApiPrefix: environmentKeyPrefix("development"),
    stagingApiPrefix: environmentKeyPrefix("staging"),
  };
}

export function validateStatusTransition(
  current: ProjectStatus,
  next: ProjectStatus,
): boolean {
  const validTransitions: Record<ProjectStatus, ProjectStatus[]> = {
    active: ["paused", "archived"],
    paused: ["active", "archived"],
    archived: ["active"],
  };

  return validTransitions[current].includes(next);
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Mint a new API key.
 *
 * Format: `pk_{env}_{40 hex}` (>= 20 bytes of entropy). Only the prefix (first
 * 16 chars, which includes the env discriminator) is stored in cleartext for
 * candidate narrowing; the rest is recoverable only via the returned fullKey.
 */
export function createApiKey(environment: ProjectEnvironment): {
  fullKey: string;
  keyPrefix: string;
  keyHash: string;
} {
  const prefix = environmentKeyPrefix(environment);
  const rawKey = `${prefix}${randomBytes(24).toString("hex")}`;

  return {
    fullKey: rawKey,
    keyPrefix: rawKey.slice(0, 16),
    keyHash: hashApiKey(rawKey),
  };
}

export function extractApiKeyPrefix(rawKey: string): string | null {
  const value = rawKey.trim();

  if (
    !value.startsWith("pk_live_") &&
    !value.startsWith("pk_dev_") &&
    !value.startsWith("pk_stg_")
  ) {
    return null;
  }

  return value.length >= 16 ? value.slice(0, 16) : null;
}

export function constantTimeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

/** Default permission set for a freshly minted key of a given type. */
export function defaultPermissionsForType(keyType: ApiKeyType): string[] {
  switch (keyType) {
    case "read_only":
      return ["ingest:read", "events:read", "metrics:read"];
    case "ingestion_only":
      return ["ingest:write"];
    case "admin":
      return ["ingest:write", "ingest:read", "events:read", "metrics:read", "config:read"];
    case "standard":
    default:
      return ["ingest:write", "ingest:read"];
  }
}
