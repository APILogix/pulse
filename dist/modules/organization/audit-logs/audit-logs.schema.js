import { z } from "zod";
import { CursorPaginationSchema, UuidSchema } from "../shared/types.js";
export const AuditLogQuerySchema = CursorPaginationSchema.extend({
    action: z.string().max(100).optional(),
    entityType: z.string().max(100).optional(),
    actorUserId: UuidSchema.optional(),
});
//# sourceMappingURL=audit-logs.schema.js.map