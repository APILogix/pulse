import { describe, it, expect, vi } from "vitest";
import { DomainsService } from "../../../src/modules/organization/domains/domains.service.js";
import { ValidationError, NotFoundError } from "../../../src/modules/organization/shared/errors.js";
import type { RequestMeta } from "../../../src/modules/organization/types.js";

describe("DomainsService Security and Timer Leak Hardening", () => {
  const meta: RequestMeta = {
    actorUserId: "owner-uuid",
    actorEmail: "owner@company.com",
    actorRole: "owner",
  } as any;

  describe("SSRF Domain Validation", () => {
    const mockRepo = {
      list: vi.fn(),
      find: vi.fn(),
      create: vi.fn(),
    };
    const service = new DomainsService(
      mockRepo as any,
      vi.fn().mockResolvedValue({ role: "owner" }),
      vi.fn().mockResolvedValue(undefined),
      { info: vi.fn(), error: vi.fn() } as any,
    );

    it("rejects public email domains (gmail, yahoo, protonmail, etc.)", async () => {
      await expect(service.create(meta, "org-1", "gmail.com")).rejects.toThrow(ValidationError);
      await expect(service.create(meta, "org-1", "proton.me")).rejects.toThrow(ValidationError);
      await expect(service.create(meta, "org-1", "yahoo.com")).rejects.toThrow(ValidationError);
    });

    it("rejects loopback, localhost, and RFC 6761 special use domains", async () => {
      await expect(service.create(meta, "org-1", "localhost")).rejects.toThrow(ValidationError);
      await expect(service.create(meta, "org-1", "test.localhost")).rejects.toThrow(ValidationError);
    });

    it("rejects IPv4 and IPv6 addresses", async () => {
      await expect(service.create(meta, "org-1", "127.0.0.1")).rejects.toThrow(ValidationError);
      await expect(service.create(meta, "org-1", "169.254.169.254")).rejects.toThrow(ValidationError);
      await expect(service.create(meta, "org-1", "::1")).rejects.toThrow(ValidationError);
      await expect(service.create(meta, "org-1", "[::1]")).rejects.toThrow(ValidationError);
      await expect(service.create(meta, "org-1", "fe80::1")).rejects.toThrow(ValidationError);
    });

    it("rejects internal TLDs used in SSRF attacks", async () => {
      await expect(service.create(meta, "org-1", "intranet.local")).rejects.toThrow(ValidationError);
      await expect(service.create(meta, "org-1", "vault.internal")).rejects.toThrow(ValidationError);
      await expect(service.create(meta, "org-1", "server.corp")).rejects.toThrow(ValidationError);
      await expect(service.create(meta, "org-1", "gateway.lan")).rejects.toThrow(ValidationError);
    });

    it("rejects credentials, schemes, and wildcards in domain names", async () => {
      await expect(service.create(meta, "org-1", "admin@domain.com")).rejects.toThrow(ValidationError);
      await expect(service.create(meta, "org-1", "http://domain.com")).rejects.toThrow(ValidationError);
      await expect(service.create(meta, "org-1", "*.domain.com")).rejects.toThrow(ValidationError);
    });
  });

  describe("DNS Resolution Timer Leak Prevention", () => {
    it("clears timeout timer on successful DNS lookup", async () => {
      const mockRepo = {
        find: vi.fn().mockResolvedValue({
          id: "d-1",
          domain: "example-corp.com",
          verification_token: "pulse-verification=secret123",
          is_verified: false,
        }),
        withTransaction: vi.fn().mockImplementation(async (cb) => cb({})),
        verificationResult: vi.fn().mockResolvedValue({
          id: "d-1",
          domain: "example-corp.com",
          is_verified: true,
        }),
      };

      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      const mockResolveTxt = vi.fn().mockResolvedValue([["pulse-verification=secret123"]]);

      const service = new DomainsService(
        mockRepo as any,
        vi.fn().mockResolvedValue({ role: "owner" }),
        vi.fn().mockResolvedValue(undefined),
        { info: vi.fn(), error: vi.fn() } as any,
        mockResolveTxt,
      );

      const res = await service.verifyInternal("org-1", "d-1", meta);
      expect(res.verified).toBe(true);
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it("clears timeout timer on DNS resolution failure", async () => {
      const mockRepo = {
        find: vi.fn().mockResolvedValue({
          id: "d-1",
          domain: "example-corp.com",
          verification_token: "pulse-verification=secret123",
          is_verified: false,
        }),
        withTransaction: vi.fn().mockImplementation(async (cb) => cb({})),
        verificationResult: vi.fn().mockResolvedValue({
          id: "d-1",
          domain: "example-corp.com",
          is_verified: false,
        }),
      };

      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      const mockResolveTxt = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));

      const service = new DomainsService(
        mockRepo as any,
        vi.fn().mockResolvedValue({ role: "owner" }),
        vi.fn().mockResolvedValue(undefined),
        { info: vi.fn(), error: vi.fn() } as any,
        mockResolveTxt,
      );

      const res = await service.verifyInternal("org-1", "d-1", meta);
      expect(res.verified).toBe(false);
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });
});
