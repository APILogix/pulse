/**
 * Bounded dependency-free 5-field cron matcher & next-occurrence calculator.
 *
 * Supports: lists (1,3,5), ranges (1-5), steps (0/15 or 1-30/5), wildcards (*),
 * and day/month names (MON-SUN, JAN-DEC). Timezone-aware via Intl.DateTimeFormat.
 *
 * Fields: minute(0-59) hour(0-23) dom(1-31) month(1-12) dow(0-7, 0=7=Sunday)
 *
 * Bounded: calculates at most 527040 minutes ahead (1 year) before giving up.
 * No regex engine abuse, no eval, no external deps.
 */
interface CronFields {
    minutes: Set<number>;
    hours: Set<number>;
    daysOfMonth: Set<number>;
    months: Set<number>;
    daysOfWeek: Set<number>;
}
/**
 * Parse a 5-field cron expression into a CronFields structure.
 * Throws on invalid expression.
 */
export declare function parseCron(expression: string): CronFields;
/**
 * Check if a given Date matches a parsed cron expression.
 * Optionally computes in a specific timezone.
 */
export declare function matchesCron(date: Date, fields: CronFields, timezone?: string): boolean;
/**
 * Calculate the next occurrence AFTER `after` that matches the cron expression.
 * Searches up to `maxMinutes` ahead (default: 527040 = 366 days).
 * Returns null if no match found within the bound (extremely defensive).
 *
 * @param expression  5-field cron string
 * @param after       Start searching after this time (exclusive; snaps to next minute)
 * @param timezone    IANA timezone (default: 'UTC')
 * @param maxMinutes  Maximum minutes to search ahead
 */
export declare function nextCronOccurrence(expression: string, after: Date, timezone?: string, maxMinutes?: number): Date | null;
/**
 * Calculate next occurrence from pre-parsed fields (avoids re-parsing).
 */
export declare function nextCronOccurrenceFromFields(fields: CronFields, after: Date, timezone?: string, maxMinutes?: number): Date | null;
/**
 * Validate a cron expression without calculating next occurrence.
 * Returns true if the expression is syntactically valid.
 */
export declare function isValidCron(expression: string): boolean;
export {};
//# sourceMappingURL=cron.d.ts.map