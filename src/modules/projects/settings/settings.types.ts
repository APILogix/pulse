import { z } from "zod";
import { normalizeObjectKeys } from "../shared/schema-utils.js";

export interface ProjectSettings {
  id: string;
  projectId: string;
  organizationId: string;
  retentionDays: number;
  maxEventsPerSecond: number;
  autoArchive: boolean;
  alertingEnabled: boolean;
  ingestionEnabled: boolean;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export const UpdateProjectSettingsBodySchema = z.object({
  retentionDays: z.number().optional(),
  maxEventsPerSecond: z.number().optional(),
  autoArchive: z.boolean().optional(),
  alertingEnabled: z.boolean().optional(),
  ingestionEnabled: z.boolean().optional()
});
