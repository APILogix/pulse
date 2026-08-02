import { z } from "zod";
import { UuidSchema, CursorPaginationSchema, OrgRoleSchema, MemberStatusSchema } from "../shared/types.js";
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
//# sourceMappingURL=members.schema.js.map