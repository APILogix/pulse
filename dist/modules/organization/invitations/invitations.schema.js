import { z } from "zod";
import { UuidSchema, CursorPaginationSchema, OrgRoleSchema } from "../shared/types.js";
export const InvitationStatusSchema = z.enum([
    "pending",
    "accepted",
    "declined",
    "expired",
    "revoked",
]);
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
//# sourceMappingURL=invitations.schema.js.map