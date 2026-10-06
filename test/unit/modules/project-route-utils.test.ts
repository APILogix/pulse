import { describe, expect, it, vi } from "vitest";

import { withErrorHandling } from "../../../src/modules/projects/shared/route-utils.js";

describe("project route utilities", () => {
  it("does not send an error response after the route already sent a reply", async () => {
    const request = {
      url: "/organizations/org-1/projects",
      log: {
        error: vi.fn(),
      },
    } as any;
    let sent = false;
    const reply = {
      get sent() { return sent; },
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as any;

    const handler = withErrorHandling(async () => {
      sent = true;
      throw new Error("late failure");
    });

    await handler(request, reply);

    expect(request.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        path: "/organizations/org-1/projects",
      }),
      "Projects route failed",
    );
    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });
});
