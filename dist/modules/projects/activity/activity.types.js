import { z } from "zod";
import { normalizeObjectKeys } from "../shared/schema-utils.js";
export const ListProjectActivityQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    action: z.string().min(1).max(100).optional(),
}));
//# sourceMappingURL=activity.types.js.map