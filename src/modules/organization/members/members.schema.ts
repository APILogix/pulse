import { z } from "zod";
import { UuidSchema, CursorPaginationSchema, OrgRoleSchema, MemberStatusSchema } from "../shared/types.js";
import type { OrgRole, MemberStatus } from "../shared/types.js";
import type { JoinMethod } from "../types.js";

export const MemberParamsSchema = z.object({
  orgId: UuidSchema,
  userId: UuidSchema,
});

export const UpdateMemberRoleSchema = z.object({
  role: OrgRoleSchema.exclude(["owner"]),
});

export const MembersListQuerySchema = CursorPaginationSchema.extend({
  status: MemberStatusSchema.optional(),
  role: OrgRoleSchema.optional(),
});

export const SuspendMemberSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const RemoveMemberSchema = z.object({
  reason: z.string().max(500).optional(),
});

export interface OrgMemberRow {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  status: MemberStatus;
  email: string;
  full_name: string;
  invited_by: string | null;
  invited_at: Date | null;
  joined_at: Date | null;
  joined_method: JoinMethod;
  last_active_at: Date | null;
  deactivated_at: Date | null;
  deactivated_by: string | null;
  deactivation_reason: string | null;
  created_at: Date;
  updated_at: Date;
}
