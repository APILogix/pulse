import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const release = vi.fn();
const connect = vi.fn();

vi.mock("../../../src/config/database.js", () => ({
  pool: {
    connect,
    query,
  },
}));

const baseInvite = {
  id: "00000000-0000-0000-0000-000000000010",
  org_id: "00000000-0000-0000-0000-000000000001",
  invited_by: "00000000-0000-0000-0000-000000000002",
  invited_by_email: "admin@example.com",
  invited_by_name: "Admin User",
  email: "member@example.com",
  role: "member",
  token_hash: "a".repeat(64),
  expires_at: new Date("2026-07-20T00:00:00Z"),
  status: "pending",
  accepted_at: null,
  accepted_by: null,
  declined_at: null,
  revoked_at: null,
  revoked_by: null,
  resent_count: 0,
  last_resent_at: null,
  created_at: new Date("2026-07-13T00:00:00Z"),
};

async function createRepository() {
  const mod = await import("../../../src/modules/organization/invitations/invitations.repository.js");
  return new mod.InvitationsRepository();
}

function sqlCalls() {
  return query.mock.calls.map(([sql]) => String(sql));
}

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  connect.mockReset();
  connect.mockResolvedValue({ query, release });
});

describe("InvitationsRepository.createInvitation", () => {
  it("inserts the first invitation in a transaction without ON CONFLICT", async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SET TRANSACTION
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // pending select
      .mockResolvedValueOnce({ rows: [{ id: baseInvite.id }] }) // insert
      .mockResolvedValueOnce({ rows: [baseInvite] }) // joined select
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const repo = await createRepository();
    const invite = await repo.createInvitation(
      baseInvite.org_id,
      baseInvite.invited_by,
      baseInvite.email,
      baseInvite.role,
      baseInvite.token_hash,
      baseInvite.expires_at
    );

    expect(invite).toEqual(baseInvite);
    expect(sqlCalls().join("\n")).not.toMatch(/\bON\s+CONFLICT\b/i);
    expect(sqlCalls()).toEqual(expect.arrayContaining([
      expect.stringMatching(/^BEGIN$/),
      expect.stringMatching(/SET TRANSACTION ISOLATION LEVEL SERIALIZABLE/),
      expect.stringMatching(/pg_advisory_xact_lock/),
      expect.stringMatching(/FOR UPDATE OF oi/),
      expect.stringMatching(/^COMMIT$/),
    ]));
    expect(release).toHaveBeenCalledOnce();
  });

  it("updates an existing pending invitation and returns the updated row", async () => {
    const updatedInvite = {
      ...baseInvite,
      token_hash: "b".repeat(64),
      role: "admin",
      resent_count: 1,
      last_resent_at: new Date("2026-07-13T01:00:00Z"),
    };
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [baseInvite] })
      .mockResolvedValueOnce({ rows: [{ id: updatedInvite.id }] })
      .mockResolvedValueOnce({ rows: [updatedInvite] })
      .mockResolvedValueOnce({ rows: [] });

    const repo = await createRepository();
    const invite = await repo.createInvitation(
      baseInvite.org_id,
      baseInvite.invited_by,
      "Member@Example.com",
      "admin",
      updatedInvite.token_hash,
      updatedInvite.expires_at
    );

    expect(invite).toEqual(updatedInvite);
    expect(sqlCalls().join("\n")).toMatch(/resent_count=oi\.resent_count\+1/);
    expect(sqlCalls().join("\n")).not.toMatch(/\bINSERT INTO organization_invitations\b/i);
    expect(sqlCalls().join("\n")).not.toMatch(/\bON\s+CONFLICT\b/i);
  });

  it.each(["accepted", "revoked", "expired", "declined"])(
    "inserts a new invitation when the existing invitation is %s",
    async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: baseInvite.id }] })
        .mockResolvedValueOnce({ rows: [baseInvite] })
        .mockResolvedValueOnce({ rows: [] });

      const repo = await createRepository();
      await repo.createInvitation(
        baseInvite.org_id,
        baseInvite.invited_by,
        baseInvite.email,
        baseInvite.role,
        baseInvite.token_hash,
        baseInvite.expires_at
      );

      expect(sqlCalls().join("\n")).toMatch(/\bINSERT INTO organization_invitations\b/i);
      expect(sqlCalls().join("\n")).not.toMatch(/\bON\s+CONFLICT\b/i);
    }
  );

  it("uses a normalized advisory lock key to serialize duplicate requests", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: baseInvite.id }] })
      .mockResolvedValueOnce({ rows: [baseInvite] })
      .mockResolvedValueOnce({ rows: [] });

    const repo = await createRepository();
    await repo.createInvitation(
      baseInvite.org_id,
      baseInvite.invited_by,
      " Member@Example.com ",
      baseInvite.role,
      baseInvite.token_hash,
      baseInvite.expires_at
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/pg_advisory_xact_lock/),
      [`organization_invitations:${baseInvite.org_id}:member@example.com`]
    );
  });

  it("rolls back and releases the client when invitation creation fails", async () => {
    const failure = new Error("insert failed");
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ rows: [] });

    const repo = await createRepository();
    await expect(repo.createInvitation(
      baseInvite.org_id,
      baseInvite.invited_by,
      baseInvite.email,
      baseInvite.role,
      baseInvite.token_hash,
      baseInvite.expires_at
    )).rejects.toThrow("insert failed");

    expect(sqlCalls()).toEqual(expect.arrayContaining([
      expect.stringMatching(/^ROLLBACK$/),
    ]));
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("InvitationsRepository.revokeInvitation", () => {
  it("deletes a pending invitation instead of marking it revoked", async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });

    const repo = await createRepository();
    await repo.revokeInvitation(baseInvite.id, baseInvite.invited_by);

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/\bDELETE FROM organization_invitations\b/i),
      [baseInvite.id]
    );
    expect(sqlCalls().join("\n")).not.toMatch(/\bstatus\s*=\s*'revoked'\b/i);
    expect(sqlCalls().join("\n")).not.toMatch(/\brevoked_at\b/i);
    expect(sqlCalls().join("\n")).not.toMatch(/\brevoked_by\b/i);
  });
});
