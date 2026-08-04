import { describe, expect, it } from "vitest";
import { normalizeEvent } from "../../src/modules/ingestion/pipeline/event-normalizer.js";

describe("error HTTP status normalization", () => {
  it("accepts optional HTTP status enrichment for error events", () => {
    const result = normalizeEvent({
      type: "error",
      message: "validation failed",
      statusCode: 422,
      statusText: "Unprocessable Entity",
      handled: true,
      requestId: "req-1",
      traceId: "trace-1",
      spanId: "span-1",
      method: "POST",
      route: "/users",
      url: "/users",
    });

    expect(result).toMatchObject({
      ok: true,
      event: {
        statusCode: 422,
        statusText: "Unprocessable Entity",
        handled: true,
      },
    });
  });

  it("keeps non-HTTP background errors free of fabricated status codes", () => {
    const result = normalizeEvent({
      type: "error",
      message: "worker failed",
      mechanism: "worker",
      handled: false,
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.event).not.toHaveProperty("statusCode");
      expect(result.event).not.toHaveProperty("statusText");
      expect(result.event.handled).toBe(false);
    }
  });
});
