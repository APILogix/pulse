import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/database.js", () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

describe("alert-channel schemas and secret detection", () => {
  it("parses explicit false boolean inputs without truthy string coercion", async () => {
    const { CreateProjectAlertChannelBodySchema, ListProjectAlertChannelsQuerySchema } = await import(
      "../../../src/modules/projects/alerts/channels/channel.types.js"
    );
    expect(ListProjectAlertChannelsQuerySchema.parse({ enabled: "false" }).enabled).toBe(false);
    expect(CreateProjectAlertChannelBodySchema.parse({
      channelType: "email",
      name: "Email",
      destination: "alerts@example.test",
      enabled: "false",
      isDefault: "false",
    })).toMatchObject({ enabled: false, isDefault: false });
  });

  it("allows connector-reference metadata without URL-like secret material", async () => {
    const { containsUrlLikeValue } = await import(
      "../../../src/modules/projects/alerts/channels/channel.service.js"
    );
    expect(containsUrlLikeValue({
      connectorId: "7d08f588-4e65-4ad4-ad65-23af39f41df3",
      route: { connectorReference: "primary-webhook" },
    })).toBe(false);
  });

  it("finds URL-like values recursively", async () => {
    const { containsUrlLikeValue } = await import(
      "../../../src/modules/projects/alerts/channels/channel.service.js"
    );
    expect(containsUrlLikeValue({ nested: [{ endpoint: "https://example.test/hook" }] })).toBe(true);
    expect(containsUrlLikeValue({ endpoint: "hooks.example.com/services/secret" })).toBe(true);
  });
});

describe("AlertChannelRepository.resolveImmediateDeliveryTargets", () => {
  it("uses tenant parameters and explicit authoritative delivery gates", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db = { query } as unknown as Pool;
    const { AlertChannelRepository } = await import(
      "../../../src/modules/projects/alerts/channels/channel.repository.js"
    );
    const repository = new AlertChannelRepository(db);

    await repository.resolveImmediateDeliveryTargets({
      organizationId: "organization-id",
      projectId: "project-id",
      category: "security",
      severity: "critical",
    });

    const [sql, values] = query.mock.calls[0]!;
    expect(values).toEqual(["organization-id", "project-id", "security", "critical"]);
    expect(sql).toContain("FROM project_members");
    expect(sql).toContain("JOIN project_notification_preferences");

    expect(sql).toContain("JOIN project_member_alert_channel_preferences");
    expect(sql).toContain("JOIN project_alert_channels");
    expect(sql).toContain("JOIN project_connector_subscriptions");
    expect(sql).toContain("JOIN connector_configs");
    expect(sql).toContain("member.status = 'active'");
    expect(sql).toContain("connector.status = 'active'");
    expect(sql).toContain("project_pref.digest_mode = 'immediate'");
    expect(sql).toContain("member_pref.digest_mode = 'immediate'");
    expect(sql).toContain("subscription.digest_mode = 'immediate'");
    expect(sql).toContain("project_pref.category IN ('all', $3)");
    expect(sql).toContain("member_pref.category IN ('all', $3)");
  });
});


describe("project alert quiet hours", () => {
  it("validates the concrete contract and handles overnight windows", async () => {
    const { QuietHoursSchema, isQuietHoursActive } = await import(
      "../../../src/modules/projects/alerts/channels/quiet-hours.js"
    );
    const policy = QuietHoursSchema.parse({
      timezone: "UTC",
      start: "22:00",
      end: "06:00",
      days: [1],
    });
    expect(isQuietHoursActive(policy, new Date("2026-07-27T23:00:00.000Z"))).toBe(true);
    expect(isQuietHoursActive(policy, new Date("2026-07-28T05:59:00.000Z"))).toBe(true);
    expect(isQuietHoursActive(policy, new Date("2026-07-28T06:00:00.000Z"))).toBe(false);
    expect(QuietHoursSchema.safeParse({ timezone: "Not/AZone", start: "25:00", end: "06:00" }).success).toBe(false);
  });

  it("fails closed for malformed persisted non-empty policies", async () => {
    const { isQuietHoursActive } = await import(
      "../../../src/modules/projects/alerts/channels/quiet-hours.js"
    );
    expect(isQuietHoursActive({ start: "bad" })).toBe(true);
    expect(isQuietHoursActive({})).toBe(false);
  });
});
