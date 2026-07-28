import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const repositoryUrl = new URL(
  "../../../src/modules/projects/alerts/routes/alert-routes.repository.ts",
  import.meta.url,
);

describe("legacy alert-routes canonical storage", () => {
  it("uses project_alert_channels and metadata compatibility fields", async () => {
    const source = await readFile(repositoryUrl, "utf8");

    expect(source).toContain("project_alert_channels");
    expect(source).not.toContain("notification_routes");
    expect(source).toContain("destination_metadata");
    expect(source).toContain("connector_id");
    expect(source).toContain("enabled");
    expect(source).toContain("metadata.throttle");
    expect(source).toContain("metadata.schedule");
    expect(source).not.toMatch(/SET[^;]*\bthrottle\s*=/s);
    expect(source).not.toMatch(/SET[^;]*\bschedule\s*=/s);
  });

  it("tenant-scopes every mutable legacy route operation", async () => {
    const source = await readFile(repositoryUrl, "utf8");
    const mutations = source.match(/UPDATE project_alert_channels[\s\S]*?RETURNING|UPDATE project_alert_channels[\s\S]*?deleted_at IS NULL/g) ?? [];

    expect(mutations.length).toBeGreaterThanOrEqual(2);
    for (const sql of mutations) {
      expect(sql).toContain("organization_id");
      expect(sql).toContain("project_id");
    }
  });
});