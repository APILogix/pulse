import { describe, it, expect, vi } from "vitest";
import { InvitationsService } from "../../../src/modules/organization/invitations/invitations.service.js";
import { MembersService } from "../../../src/modules/organization/members/members.service.js";
import { ForbiddenError, ValidationError } from "../../../src/modules/organization/shared/errors.js";
import type { RequestMeta } from "../../../src/modules/organization/types.js";

vi.mock("../../../src/shared/email/email.service.js", () => ({
  emailService: {
    send: vi.fn().mockResolvedValue(true),
  },
}));

describe("Organization Privilege Escalation & Authorization Hardening", () => {
  const metaAdmin: RequestMeta = {
    actorUserId: "admin-user-uuid",
    actorEmail: "admin@example.com",
    actorRole: "admin",
  } as any;

  const metaOwner: RequestMeta = {
    actorUserId: "owner-user-uuid",
    actorEmail: "owner@example.com",
    actorRole: "owner",
  } as any;

  describe("InvitationsService.inviteMember", () => {
    it("prevents an admin from inviting an owner", async () => {
      const mockRepo = {
        createInvitation: vi.fn(),
        findUserByEmail: vi.fn().mockResolvedValue(null),
      };
      const invitations = new InvitationsService({
        repository: mockRepo as any,
        log: { error: vi.fn(), info: vi.fn() } as any,
        requireMutableOrg: vi.fn().mockResolvedValue({ id: "org-1", name: "Org 1" } as any),
        requireMember: vi.fn().mockResolvedValue({ id: "m-1", user_id: "admin-user-uuid", role: "admin" } as any),
        audit: vi.fn().mockResolvedValue(undefined),
        enforceBillingLimit: vi.fn().mockResolvedValue({}),
      });

      await expect(
        invitations.inviteMember(metaAdmin, "org-1", "newowner@example.com", "owner")
      ).rejects.toThrow(ForbiddenError);
      expect(mockRepo.createInvitation).not.toHaveBeenCalled();
    });

    it("allows an owner to invite an owner", async () => {
      const mockRepo = {
        createInvitation: vi.fn().mockResolvedValue({
          id: "inv-1",
          org_id: "org-1",
          email: "newowner@example.com",
          role: "owner",
          status: "pending",
          expires_at: new Date(),
          created_at: new Date(),
          invited_by: "owner-user-uuid",
        }),
        findUserByEmail: vi.fn().mockResolvedValue(null),
      };
      const invitations = new InvitationsService({
        repository: mockRepo as any,
        log: { error: vi.fn(), info: vi.fn() } as any,
        requireMutableOrg: vi.fn().mockResolvedValue({ id: "org-1", name: "Org 1" } as any),
        requireMember: vi.fn().mockResolvedValue({ id: "m-2", user_id: "owner-user-uuid", role: "owner" } as any),
        audit: vi.fn().mockResolvedValue(undefined),
        enforceBillingLimit: vi.fn().mockResolvedValue({}),
      });

      const res = await invitations.inviteMember(metaOwner, "org-1", "newowner@example.com", "owner");
      expect(res.id).toBe("inv-1");
      expect(res.role).toBe("owner");
      expect(mockRepo.createInvitation).toHaveBeenCalled();
    });
  });

  describe("MembersService.addMember & removeMember", () => {
    it("prevents an admin from directly adding an owner", async () => {
      const mockRepo = {
        findMember: vi.fn().mockResolvedValue(null),
        addMember: vi.fn(),
      };
      const members = new MembersService({
        repository: mockRepo as any,
        requireMutableOrg: vi.fn().mockResolvedValue({ id: "org-1" } as any),
        audit: vi.fn().mockResolvedValue(undefined),
        enforceBillingLimit: vi.fn().mockResolvedValue({}),
      });
      // Mock requireMember to return admin role for actor
      vi.spyOn(members, "requireMember").mockResolvedValue({ id: "m-1", user_id: "admin-user-uuid", role: "admin" } as any);

      await expect(
        members.addMember(metaAdmin, "org-1", "target-user-uuid", "owner")
      ).rejects.toThrow(ForbiddenError);
      expect(mockRepo.addMember).not.toHaveBeenCalled();
    });

    it("prevents an admin from removing an owner", async () => {
      const mockRepo = {
        findMember: vi.fn().mockResolvedValue({ id: "m-target", user_id: "target-owner-uuid", role: "owner" }),
        removeMember: vi.fn(),
        countActiveOwners: vi.fn().mockResolvedValue(2),
      };
      const members = new MembersService({
        repository: mockRepo as any,
        requireMutableOrg: vi.fn().mockResolvedValue({ id: "org-1" } as any),
        audit: vi.fn().mockResolvedValue(undefined),
        enforceBillingLimit: vi.fn().mockResolvedValue({}),
      });
      vi.spyOn(members, "requireMember").mockResolvedValue({ id: "m-1", user_id: "admin-user-uuid", role: "admin" } as any);

      await expect(
        members.removeMember(metaAdmin, "org-1", "target-owner-uuid")
      ).rejects.toThrow(ForbiddenError);
      expect(mockRepo.removeMember).not.toHaveBeenCalled();
    });

    it("prevents an owner from removing the last owner", async () => {
      const mockRepo = {
        findMember: vi.fn().mockResolvedValue({ id: "m-target", user_id: "target-owner-uuid", role: "owner" }),
        removeMember: vi.fn(),
        countActiveOwners: vi.fn().mockResolvedValue(1),
      };
      const members = new MembersService({
        repository: mockRepo as any,
        requireMutableOrg: vi.fn().mockResolvedValue({ id: "org-1" } as any),
        audit: vi.fn().mockResolvedValue(undefined),
        enforceBillingLimit: vi.fn().mockResolvedValue({}),
      });
      vi.spyOn(members, "requireMember").mockResolvedValue({ id: "m-1", user_id: "owner-user-uuid", role: "owner" } as any);

      await expect(
        members.removeMember(metaOwner, "org-1", "target-owner-uuid")
      ).rejects.toThrow(ValidationError);
      expect(mockRepo.removeMember).not.toHaveBeenCalled();
    });

    it("allows an owner to remove another owner when multiple owners exist", async () => {
      const mockRepo = {
        findMember: vi.fn().mockResolvedValue({ id: "m-target", user_id: "target-owner-uuid", role: "owner" }),
        removeMember: vi.fn().mockResolvedValue(undefined),
        countActiveOwners: vi.fn().mockResolvedValue(2),
      };
      const members = new MembersService({
        repository: mockRepo as any,
        requireMutableOrg: vi.fn().mockResolvedValue({ id: "org-1" } as any),
        audit: vi.fn().mockResolvedValue(undefined),
        enforceBillingLimit: vi.fn().mockResolvedValue({}),
      });
      vi.spyOn(members, "requireMember").mockResolvedValue({ id: "m-1", user_id: "owner-user-uuid", role: "owner" } as any);

      await members.removeMember(metaOwner, "org-1", "target-owner-uuid");
      expect(mockRepo.removeMember).toHaveBeenCalledWith("org-1", "target-owner-uuid", "owner-user-uuid", undefined);
    });
  });
});
