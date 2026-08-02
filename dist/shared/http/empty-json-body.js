/**
 * SDK bootstrap clients may POST `Content-Type: application/json` with a
 * zero-byte body. Fastify's default JSON parser rejects that before handlers
 * can apply their own `{}` fallback, so this scoped override preserves the
 * default secure parser for real JSON and maps empty JSON to an empty object.
 */
export function acceptEmptyJsonBodyAsObject(fastify) {
    const defaultJsonParser = fastify.getDefaultJsonParser("error", "error");
    fastify.removeContentTypeParser("application/json");
    fastify.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
        const rawBody = body;
        if (rawBody.length === 0) {
            done(null, {});
            return;
        }
        defaultJsonParser(request, rawBody, done);
    });
}
//# sourceMappingURL=empty-json-body.js.map