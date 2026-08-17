import { describe, it, expect, vi } from "vitest";
import { CoreRepository } from "../../src/modules/organization/core/core.repository.js";
import { ConflictError } from "../../src/modules/organization/shared/errors.js";

describe("Organization Slug Availability & Creation", () => {
  it("validates slug availability correctly", async () => {
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        if (params && params[0] === "existing-org") {
          return { rows: [{ x: true }] };
        }
        return { rows: [{ x: false }] };
      }),
    };

    const repo = new CoreRepository();
    (repo as any).db = mockDb;

    // Reserved slug
    expect(await repo.isSlugAvailable("admin")).toBe(false);
    expect(await repo.isSlugAvailable("api")).toBe(false);
    expect(await repo.isSlugAvailable("settings")).toBe(false);

    // Too short
    expect(await repo.isSlugAvailable("a")).toBe(false);

    // Existing slug
    expect(await repo.isSlugAvailable("existing-org")).toBe(false);

    // Available slug
    expect(await repo.isSlugAvailable("new-company")).toBe(true);
  });

  it("handles duplicate key constraint violations gracefully as ConflictError", async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT EXISTS(SELECT 1 FROM organizations WHERE owner_user_id")) {
          return { rows: [{ x: false }] };
        }
        if (sql.includes("SELECT EXISTS(SELECT 1 FROM organizations WHERE slug")) {
          return { rows: [{ x: false }] };
        }
        if (sql.includes("INSERT INTO organizations")) {
          const err: any = new Error("duplicate key value violates unique constraint idx_org_slug_active");
          err.code = "23505";
          err.constraint = "idx_org_slug_active";
          throw err;
        }
        return { rows: [] };
      }),
    };

    const repo = new CoreRepository();

    await expect(
      repo.createOrg(mockClient as any, "Love", "user-uuid", { slug: "love" })
    ).rejects.toThrow(ConflictError);
  });
});
