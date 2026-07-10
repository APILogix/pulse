import { z } from "zod";
import { normalizeObjectKeys } from "../shared/schema-utils.js";
export const UpdateProjectSettingsBodySchema = z.object({
    retentionDays: z.number().optional(),
    maxEventsPerSecond: z.number().optional(),
    autoArchive: z.boolean().optional(),
    alertingEnabled: z.boolean().optional(),
    ingestionEnabled: z.boolean().optional()
});
//# sourceMappingURL=settings.types.js.map