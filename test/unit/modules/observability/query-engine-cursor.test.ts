import { describe, it, expect } from "vitest";
import {
  createCursorPayload,
  encodeCursor,
  decodeCursor,
  cursorScopeFingerprint,
} from "../../../../src/modules/observability/query-engine/cursor.js";
import { QueryValidationError } from "../../../../src/modules/observability/query-engine/errors.js";
import type { ExplorerResource } from "../../../../src/modules/observability/query-engine/field-registry.js";
import type { QueryContext } from "../../../../src/modules/observability/query-engine/context.js";
import type { ExplorerQuery } from "../../../../src/modules/observability/query-engine/parser.js";

describe("Observability Query Engine - Composite Cursor & Continuity Contract", () => {
  const mockResource = { name: "traces" } as ExplorerResource;
  const mockContext: QueryContext = {
    organizationId: "org-123",
    projectId: "proj-123",
    allowedProjectIds: ["proj-123"],
    isSuperAdmin: false,
    canAccessProduction: true,
  };
  const mockQuery: ExplorerQuery = {
    timeRange: {
      from: new Date("2026-09-21T00:00:00.000Z"),
      to: new Date("2026-09-22T00:00:00.000Z"),
    },
    filters: [{ field: "status", op: "eq", value: "ok" }],
    sort: { field: "occurred_at", direction: "desc" },
    limit: 25,
    cursor: null,
    search: null,
  };

  it("generates deterministic HMAC-signed composite cursors using (time, id)", () => {
    const boundary = {
      time: new Date("2026-09-22T12:00:00.000Z"),
      id: "span-abc-001",
    };

    const payload = createCursorPayload(mockResource, mockContext, mockQuery, boundary);
    const cursor = encodeCursor(payload);

    expect(cursor).toBeTypeOf("string");
    expect(cursor).toContain(".");

    const scope = cursorScopeFingerprint(mockResource, mockContext, mockQuery);
    const decoded = decodeCursor(cursor, {
      resource: "traces",
      sortField: "occurred_at",
      sortDirection: "desc",
      scope,
    });

    expect(decoded.id).toBe("span-abc-001");
    expect(decoded.t).toBe(boundary.time.toISOString());
    expect(decoded.d).toBe("desc");
  });

  it("prevents timestamp collision issues by using unique ID as the deterministic tie-breaker", () => {
    const time = new Date("2026-09-22T12:00:00.000Z");
    const payload1 = createCursorPayload(mockResource, mockContext, mockQuery, { time, id: "record-001" });
    const payload2 = createCursorPayload(mockResource, mockContext, mockQuery, { time, id: "record-002" });

    const cursor1 = encodeCursor(payload1);
    const cursor2 = encodeCursor(payload2);

    expect(cursor1).not.toBe(cursor2);

    const scope = cursorScopeFingerprint(mockResource, mockContext, mockQuery);
    const decoded1 = decodeCursor(cursor1, { resource: "traces", sortField: "occurred_at", sortDirection: "desc", scope });
    const decoded2 = decodeCursor(cursor2, { resource: "traces", sortField: "occurred_at", sortDirection: "desc", scope });

    expect(decoded1.t).toBe(decoded2.t);
    expect(decoded1.id).toBe("record-001");
    expect(decoded2.id).toBe("record-002");
  });

  it("invalidates the cursor if query filters change (query fingerprint mismatch)", () => {
    const boundary = { time: new Date("2026-09-22T12:00:00.000Z"), id: "span-001" };
    const payload = createCursorPayload(mockResource, mockContext, mockQuery, boundary);
    const cursor = encodeCursor(payload);

    const changedQuery: ExplorerQuery = {
      ...mockQuery,
      filters: [{ field: "status", op: "eq", value: "error" }], // changed filter
    };

    const newScope = cursorScopeFingerprint(mockResource, mockContext, changedQuery);

    // Attempting to decode cursor with the new query scope throws QueryValidationError
    expect(() => {
      decodeCursor(cursor, {
        resource: "traces",
        sortField: "occurred_at",
        sortDirection: "desc",
        scope: newScope,
      });
    }).toThrow(QueryValidationError);
  });

  it("rejects tampered or malformed cursor strings", () => {
    const boundary = { time: new Date("2026-09-22T12:00:00.000Z"), id: "span-001" };
    const payload = createCursorPayload(mockResource, mockContext, mockQuery, boundary);
    const validCursor = encodeCursor(payload);

    const tampered = validCursor.slice(0, -4) + "XXXX";
    expect(() => decodeCursor(tampered)).toThrow(QueryValidationError);
    expect(() => decodeCursor("invalid.signature.cursor")).toThrow(QueryValidationError);
    expect(() => decodeCursor("just-a-plain-string")).toThrow(QueryValidationError);
  });
});
