import { z } from "zod";
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm in 24-hour time");
const TimeZoneSchema = z.string().trim().min(1).max(100).refine((value) => {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
        return true;
    }
    catch {
        return false;
    }
}, "Expected a valid IANA time zone");
export const QuietHoursConfigSchema = z.object({
    enabled: z.boolean().default(true),
    timezone: TimeZoneSchema.default("UTC"),
    start: TimeSchema,
    end: TimeSchema,
    days: z.array(z.number().int().min(0).max(6)).max(7).default([0, 1, 2, 3, 4, 5, 6]),
}).strict();
export const QuietHoursSchema = z.union([
    z.object({}).strict(),
    QuietHoursConfigSchema,
]);
function localParts(now, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(now);
    const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
    return { day: Math.max(0, day), minutes: hour * 60 + minute };
}
function toMinutes(value) {
    const [hour, minute] = value.split(":").map(Number);
    return (hour ?? 0) * 60 + (minute ?? 0);
}
/** Invalid non-empty policies fail closed so a malformed preference never bypasses muting. */
export function isQuietHoursActive(value, now = new Date()) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0)
        return false;
    const parsed = QuietHoursConfigSchema.safeParse(value);
    if (!parsed.success)
        return true;
    const config = parsed.data;
    if (!config.enabled || config.days.length === 0)
        return false;
    const local = localParts(now, config.timezone);
    const start = toMinutes(config.start);
    const end = toMinutes(config.end);
    if (start === end)
        return config.days.includes(local.day);
    if (start < end) {
        return config.days.includes(local.day) && local.minutes >= start && local.minutes < end;
    }
    const previousDay = (local.day + 6) % 7;
    return (config.days.includes(local.day) && local.minutes >= start)
        || (config.days.includes(previousDay) && local.minutes < end);
}
export function isAnyQuietHoursActive(values, now = new Date()) {
    return values.some((value) => isQuietHoursActive(value, now));
}
//# sourceMappingURL=quiet-hours.js.map