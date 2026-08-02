/**
 * Canonical SDK delivery routes: `POST /v1/init` and `POST /v1/sdk-config`.
 *
 * Authorization is rooted in the presented API key (design.md §7.3, Property 1):
 *   - The bearer/X-API-Key credential is verified with a constant-time compare.
 *   - Organization comes from the key mapping.
 *   - Project/environment are SDK metadata and select a committed config inside
 *     that organization; environment UUIDs are not accepted from the SDK.
 *
 * Returns the complete schema-v1 document with `ETag` and `X-Config-Revision`
 * (revision/publish metadata travels in headers, never inside schema-v1 `meta`).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { pool } from "../../../config/database.js";
import { extractApiKeyPrefix } from "../shared/utils.js";
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
    const publicKey = extractApiKeyPrefix(rawKey);
    if (!publicKey)
        return null;
    const result = await pool.query(`SELECT p.org_id AS organization_id, k.project_id, k.environment_id, k.secret_hash
       FROM project_api_keys k
       JOIN projects p ON p.id = k.project_id AND p.deleted_at IS NULL
      WHERE k.public_key = $1 AND k.status = 'active' AND k.deleted_at IS NULL
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
    if (typeof body.metadata?.projectId === "string")
        hints.projectId = body.metadata.projectId;
    else if (typeof body.projectId === "string")
        hints.projectId = body.projectId;
    if (typeof body.metadata?.environment === "string")
        hints.environment = body.metadata.environment;
    else if (typeof body.environment === "string")
        hints.environment = body.environment;
    // Fallback for older SDKs that do not send metadata. New SDKs select by
    // metadata.projectId + metadata.environment; only org id is taken from the key.
    hints.environmentId = mapping.defaultEnvironmentId;
    return hints;
}
/**
 * Register both SDK bootstrap names against one handler. This guarantees
 * `/v1/init` and `/v1/sdk-config` use the same API-key mapping, service call,
 * response document, and cache/revision headers.
 */
export function registerSdkDeliveryRoutes(fastify, service) {
    const deliver = async (request, reply) => {
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
    };
    fastify.post("/v1/init", deliver);
    fastify.post("/v1/sdk-config", deliver);
}
//# sourceMappingURL=sdk-config.delivery.routes.js.map