/**
 * SDK delivery route: `POST /v1/sdk-config`.
 *
 * Authorization is rooted in the presented API key (design.md §7.3, Property 1):
 *   - The bearer/X-API-Key credential is verified with a constant-time compare.
 *   - Organization/project/environment come from the key mapping, NEVER the body.
 *   - The request body's `projectId`/`service` are ignored; `environment` is a
 *     hint that only selects an environment already granted to the key.
 *
 * Returns the complete schema-v1 document with `ETag` and `X-Config-Revision`
 * (revision/publish metadata travels in headers, never inside schema-v1 `meta`).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { pool } from "../../../config/database.js";
import { SdkConfigError } from "./errors.js";
/** Extract the raw API key from `Authorization: Bearer` or `X-API-Key`. */
function extractApiKey(request) {
    const headerKey = request.headers["x-api-key"];
    if (typeof headerKey === "string" && headerKey.trim().length > 0)
        return headerKey.trim();
    const auth = request.headers.authorization;
    if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
        return auth.slice(7).trim() || null;
    }
    return null;
}
function sha256Hex(input) {
    return createHash("sha256").update(input, "utf8").digest("hex");
}
/** Constant-time hex comparison that never short-circuits on length. */
function constantTimeHexEqual(a, b) {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
        // Compare against self to keep timing uniform, then fail.
        timingSafeEqual(bufA, bufA);
        return false;
    }
    return timingSafeEqual(bufA, bufB);
}
/**
 * Resolve and verify the API key, returning its authoritative mapping. A pulse
 * key maps to exactly one environment, which is both the default and the only
 * granted environment.
 */
async function resolveApiKeyMapping(rawKey) {
    const publicKey = rawKey.includes(".") ? rawKey.slice(0, rawKey.lastIndexOf(".")) : rawKey;
    const result = await pool.query(`SELECT organization_id, project_id, environment_id, secret_hash
       FROM project_api_keys
      WHERE public_key = $1 AND status = 'active' AND deleted_at IS NULL
      LIMIT 1`, [publicKey]);
    const row = result.rows[0];
    if (!row)
        return null;
    if (!constantTimeHexEqual(sha256Hex(rawKey), row.secret_hash))
        return null;
    return {
        organizationId: row.organization_id,
        projectId: row.project_id,
        defaultEnvironmentId: row.environment_id,
        allowedEnvironmentIds: [row.environment_id],
    };
}
function toHints(body, mapping) {
    const hints = {};
    if (typeof body.schemaVersion === "number")
        hints.schemaVersion = body.schemaVersion;
    if (Array.isArray(body.capabilities))
        hints.capabilities = body.capabilities.filter((c) => typeof c === "string");
    if (typeof body.projectId === "string")
        hints.projectId = body.projectId;
    // `environment` is a slug hint. A pulse key grants one environment, so the hint
    // can only ever resolve to that environment or fall back to it. Body identity
    // never widens scope.
    hints.environmentId = mapping.defaultEnvironmentId;
    return hints;
}
/** Register the API-key-authenticated SDK delivery route. */
export function registerSdkDeliveryRoutes(fastify, service) {
    fastify.post("/v1/sdk-config", async (request, reply) => {
        const rawKey = extractApiKey(request);
        if (!rawKey) {
            return reply.code(401).send({ error: { code: "unauthorized", message: "Missing API key" } });
        }
        let mapping;
        try {
            mapping = await resolveApiKeyMapping(rawKey);
        }
        catch (error) {
            request.log.error({ err: error }, "sdk-config delivery key resolution failed");
            return reply.code(503).send({ error: { code: "unavailable", message: "Configuration temporarily unavailable" } });
        }
        if (!mapping) {
            // Uniform 401 body/timing to resist enumeration.
            return reply.code(401).send({ error: { code: "unauthorized", message: "Invalid API key" } });
        }
        const body = (request.body ?? {});
        try {
            const result = await service.buildDelivery(mapping, toHints(body, mapping));
            reply.header("ETag", result.etag);
            reply.header("X-Config-Revision", String(result.revisionNo));
            reply.header("Cache-Control", "private, no-cache");
            return reply.code(200).send(result.config);
        }
        catch (error) {
            if (error instanceof SdkConfigError) {
                return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
            }
            request.log.error({ err: error }, "sdk-config delivery failed");
            return reply.code(503).send({ error: { code: "unavailable", message: "Configuration temporarily unavailable" } });
        }
    });
}
//# sourceMappingURL=sdk-config.delivery.routes.js.map