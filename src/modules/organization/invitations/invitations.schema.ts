import { z } from "zod";
import { UuidSchema, CursorPaginationSchema, OrgRoleSchema } from "../shared/types.js";
import type { OrgRole } from "../shared/types.js";

export const InvitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "declined",
  "expired",
  "revoked",
]);
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;

export const InvitationIdParamsSchema = z.object({ orgId: UuidSchema, invitationId: UuidSchema });
export const InvitationParamsSchema = z.object({ id: UuidSchema });
export const GlobalInvitationParamsSchema = z.object({ id: UuidSchema });

export const CreateInvitationSchema = z.object({
  email: z.string().email(),
  role: OrgRoleSchema.exclude(["owner"]).default("member"),
});

export const AcceptInvitationSchema = z.object({
  token: z.string().length(64),
});

export const InvitationValidateQuerySchema = z.object({
  token: z.string().length(64),
});

export const InvitationListQuerySchema = CursorPaginationSchema.extend({
  status: InvitationStatusSchema.optional(),
});

export interface OrgInvitationRow {
  id: string;
  org_id: string;
  invited_by: string;
  invited_by_email: string | null;
  invited_by_name: string | null;
  email: string;
  role: OrgRole;
  token_hash: string;
  expires_at: Date;
  status: InvitationStatus;
  accepted_at: Date | null;
  accepted_by: string | null;
  declined_at: Date | null;
  revoked_at: Date | null;
  revoked_by: string | null;
  resent_count: number;
  last_resent_at: Date | null;
  created_at: Date;
}
