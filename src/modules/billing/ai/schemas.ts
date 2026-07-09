import { z } from 'zod';

export const ConsumeAiCreditsSchema = z.object({
  featureKey: z.string().trim().min(1).max(100),
  provider: z.string().trim().min(1).max(50),
  model: z.string().trim().min(1).max(100),
  promptTokens: z.number().int().min(0).default(0),
  completionTokens: z.number().int().min(0).default(0),
  projectId: z.string().uuid().optional(),
});

export type ConsumeAiCreditsBody = z.infer<typeof ConsumeAiCreditsSchema>;
