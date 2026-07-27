import { z } from "zod";
import { normalizeObjectKeys } from "../shared/schema-utils.js";

export interface ProjectSettings {
  id: string;
  projectId: string;
  organizationId: string;
  dataRetentionDays: number;
  samplingRate: number;
  allowedDomains: string[];
  blockedDomains: string[];
  piiScrubbingEnabled: boolean;
  ipCollectionEnabled: boolean;
  releaseTrackingEnabled: boolean;
  sessionReplayEnabled: boolean;
  performanceMonitoringEnabled: boolean;
  errorMonitoringEnabled: boolean;
  logIngestionEnabled: boolean;
  metricIngestionEnabled: boolean;
  traceIngestionEnabled: boolean;
  profileIngestionEnabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const UpdateProjectSettingsBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    dataRetentionDays: z.coerce.number().int().min(1).max(3650).optional(),
    samplingRate: z.coerce.number().min(0).max(1).optional(),
    allowedDomains: z.array(z.string().min(1).max(255)).max(500).optional(),
    blockedDomains: z.array(z.string().min(1).max(255)).max(500).optional(),
    piiScrubbingEnabled: z.coerce.boolean().optional(),
    ipCollectionEnabled: z.coerce.boolean().optional(),
    releaseTrackingEnabled: z.coerce.boolean().optional(),
    sessionReplayEnabled: z.coerce.boolean().optional(),
    performanceMonitoringEnabled: z.coerce.boolean().optional(),
    errorMonitoringEnabled: z.coerce.boolean().optional(),
    logIngestionEnabled: z.coerce.boolean().optional(),
    metricIngestionEnabled: z.coerce.boolean().optional(),
    traceIngestionEnabled: z.coerce.boolean().optional(),
    profileIngestionEnabled: z.coerce.boolean().optional(),
    version: z.coerce.number().int().min(1).optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting is required",
  }),
);

export type UpdateProjectSettingsBody = z.infer<typeof UpdateProjectSettingsBodySchema>;
