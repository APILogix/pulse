import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import type { OrgRole, ProjectEnvironment, ProjectStatus } from "./types.js";

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 5,
  admin: 4,
  billing: 3,
  member: 2,
  viewer: 1,
};

export class ProjectError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "ProjectError";
  }
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

export function hasRequiredRole(
  role: OrgRole,
  requiredRole: OrgRole,
): boolean {
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

export function buildApiPrefixes(slug: string): {
  productionApiPrefix: string;
  developmentApiPrefix: string;
} {
  const suffix =
    slug.replace(/[^a-z0-9]/g, "").slice(0, 8) ||
    randomBytes(4).toString("hex");

  return {
    productionApiPrefix: `pk_live_`,
    developmentApiPrefix: `pk_dev_`,
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

export function createApiKey(environment: ProjectEnvironment): {
  fullKey: string;
  keyPrefix: string;
  keyHash: string;
} {
  const prefix = environment === "production" ? "pk_live_" : "pk_dev_";
  const rawKey = `${prefix}${randomBytes(20).toString("hex")}`;

  return {
    fullKey: rawKey,
    keyPrefix: rawKey.slice(0, 16),
    keyHash: hashApiKey(rawKey),
  };
}

export function extractApiKeyPrefix(rawKey: string): string | null {
  const value = rawKey.trim();

  if (!value.startsWith("pk_live_") && !value.startsWith("pk_dev_")) {
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
