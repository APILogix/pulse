import { z } from 'zod';
export declare const ConsumeAiCreditsSchema: z.ZodObject<{
    featureKey: z.ZodString;
    provider: z.ZodString;
    model: z.ZodString;
    promptTokens: z.ZodDefault<z.ZodNumber>;
    completionTokens: z.ZodDefault<z.ZodNumber>;
    projectId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ConsumeAiCreditsBody = z.infer<typeof ConsumeAiCreditsSchema>;
//# sourceMappingURL=schemas.d.ts.map