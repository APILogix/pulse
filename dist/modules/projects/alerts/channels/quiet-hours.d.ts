import { z } from "zod";
export declare const QuietHoursConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    timezone: z.ZodDefault<z.ZodString>;
    start: z.ZodString;
    end: z.ZodString;
    days: z.ZodDefault<z.ZodArray<z.ZodNumber>>;
}, z.core.$strict>;
export declare const QuietHoursSchema: z.ZodUnion<readonly [z.ZodObject<{}, z.core.$strict>, z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    timezone: z.ZodDefault<z.ZodString>;
    start: z.ZodString;
    end: z.ZodString;
    days: z.ZodDefault<z.ZodArray<z.ZodNumber>>;
}, z.core.$strict>]>;
export type QuietHoursConfig = z.infer<typeof QuietHoursConfigSchema>;
/** Invalid non-empty policies fail closed so a malformed preference never bypasses muting. */
export declare function isQuietHoursActive(value: unknown, now?: Date): boolean;
export declare function isAnyQuietHoursActive(values: unknown[], now?: Date): boolean;
//# sourceMappingURL=quiet-hours.d.ts.map