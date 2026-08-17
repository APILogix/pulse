import { describe, it, expect, vi } from "vitest";
import { ProjectAlertQueryService } from "../../src/modules/alerting/runtime/project-alert-query.service.js";

describe("Project Alerting Status & Default Destination Resolution", () => {
  it("resolves project owner email fallback when organization has no connector access", async () => {
    const mockLogDb = {} as any;
    const mockPrimaryDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as any;

    const mockEntitlement = {
      resolve: vi.fn().mockResolvedValue({
        connectorAccess: false,
        reason: "CONNECTOR_ENTITLEMENT_REQUIRED",
      }),
    } as any;

    const mockOwners = {
      findActiveVerifiedOwner: vi.fn().mockResolvedValue({
        userId: "user-owner-1",
        email: "alice@example.com",
      }),
      findActiveVerifiedFallbackRecipient: vi.fn().mockResolvedValue(null),
    } as any;

    const service = new ProjectAlertQueryService(
      mockLogDb,
      mockPrimaryDb,
      mockEntitlement,
      mockOwners,
    );

    const status = await service.getAlertingStatus("org-1", "proj-1");

    expect(status.organizationId).toBe("org-1");
    expect(status.projectId).toBe("proj-1");
    expect(status.connectorAccess.allowed).toBe(false);
    expect(status.connectorStatus.configured).toBe(false);
    expect(status.defaultDestination.type).toBe("PROJECT_OWNER_EMAIL");
    expect(status.defaultDestination.target).toBe("alice@example.com");
    expect(status.defaultDestination.source).toBe("PROJECT_OWNER");
  });

  it("resolves project owner email when connector access is allowed but no connector is configured", async () => {
    const mockLogDb = {} as any;
    const mockPrimaryDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as any;

    const mockEntitlement = {
      resolve: vi.fn().mockResolvedValue({
        connectorAccess: true,
        reason: "CONNECTOR_ACCESS_ALLOWED",
      }),
    } as any;

    const mockOwners = {
      findActiveVerifiedOwner: vi.fn().mockResolvedValue({
        userId: "user-owner-1",
        email: "alice@example.com",
      }),
      findActiveVerifiedFallbackRecipient: vi.fn().mockResolvedValue(null),
    } as any;

    const service = new ProjectAlertQueryService(
      mockLogDb,
      mockPrimaryDb,
      mockEntitlement,
      mockOwners,
    );

    const status = await service.getAlertingStatus("org-1", "proj-1");

    expect(status.connectorAccess.allowed).toBe(true);
    expect(status.connectorStatus.configured).toBe(false);
    expect(status.defaultDestination.type).toBe("PROJECT_OWNER_EMAIL");
    expect(status.defaultDestination.target).toBe("alice@example.com");
  });

  it("resolves primary connector destination when connector access is allowed and active connector exists", async () => {
    const mockLogDb = {} as any;
    const mockPrimaryDb = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "conn-slack-1",
            name: "Production Slack",
            provider: "slack",
            status: "active",
          },
        ],
      }),
    } as any;

    const mockEntitlement = {
      resolve: vi.fn().mockResolvedValue({
        connectorAccess: true,
        reason: "CONNECTOR_ACCESS_ALLOWED",
      }),
    } as any;

    const mockOwners = {
      findActiveVerifiedOwner: vi.fn().mockResolvedValue({
        userId: "user-owner-1",
        email: "alice@example.com",
      }),
      findActiveVerifiedFallbackRecipient: vi.fn().mockResolvedValue(null),
    } as any;

    const service = new ProjectAlertQueryService(
      mockLogDb,
      mockPrimaryDb,
      mockEntitlement,
      mockOwners,
    );

    const status = await service.getAlertingStatus("org-1", "proj-1");

    expect(status.connectorAccess.allowed).toBe(true);
    expect(status.connectorStatus.configured).toBe(true);
    expect(status.connectorStatus.primary?.name).toBe("Production Slack");
    expect(status.defaultDestination.type).toBe("PRIMARY_CONNECTOR");
    expect(status.defaultDestination.source).toBe("PRIMARY_CONNECTOR");
    expect(status.fallbackDestination.target).toBe("alice@example.com");
  });

  it("falls back to organization admin email when project owner is unverified or absent", async () => {
    const mockLogDb = {} as any;
    const mockPrimaryDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as any;

    const mockEntitlement = {
      resolve: vi.fn().mockResolvedValue({
        connectorAccess: false,
        reason: "CONNECTOR_ENTITLEMENT_REQUIRED",
      }),
    } as any;

    const mockOwners = {
      findActiveVerifiedOwner: vi.fn().mockResolvedValue(null),
      findActiveVerifiedFallbackRecipient: vi.fn().mockResolvedValue({
        userId: "admin-user-1",
        email: "admin@example.com",
      }),
    } as any;

    const service = new ProjectAlertQueryService(
      mockLogDb,
      mockPrimaryDb,
      mockEntitlement,
      mockOwners,
    );

    const status = await service.getAlertingStatus("org-1", "proj-1");

    expect(status.defaultDestination.target).toBe("admin@example.com");
    expect(status.defaultDestination.source).toBe("ORGANIZATION_FALLBACK");
  });
});
