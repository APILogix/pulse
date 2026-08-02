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
const MONTH_NAMES = {
    JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
    JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const DOW_NAMES = {
    SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};
/**
 * Parse a single cron field into a set of matching integers.
 * @param field The raw field string (e.g., "1-5", "star/15", "1,3,5")
 * @param min Minimum allowed value (inclusive)
 * @param max Maximum allowed value (inclusive)
 * @param nameMap Optional name-to-number mapping (months, days of week)
 */
function parseField(field, min, max, nameMap) {
    const result = new Set();
    const parts = field.split(',');
    for (const part of parts) {
        if (parts.length > 60)
            throw new Error(`Too many cron list items: ${field}`);
        let rangePart = part.trim();
        let step = 1;
        // Handle step: "*/5" or "1-30/5"
        const slashIdx = rangePart.indexOf('/');
        if (slashIdx !== -1) {
            step = parseInt(rangePart.slice(slashIdx + 1), 10);
            if (!Number.isFinite(step) || step < 1 || step > (max - min + 1)) {
                throw new Error(`Invalid step in cron field: ${part}`);
            }
            rangePart = rangePart.slice(0, slashIdx);
        }
        if (rangePart === '*') {
            for (let i = min; i <= max; i += step)
                result.add(i);
        }
        else if (rangePart.includes('-')) {
            const [startStr, endStr] = rangePart.split('-');
            const start = resolveName(startStr, min, max, nameMap);
            const end = resolveName(endStr, min, max, nameMap);
            if (start > end) {
                // Wrap-around (e.g., FRI-MON for dow)
                for (let i = start; i <= max; i += step)
                    result.add(i);
                for (let i = min; i <= end; i += step)
                    result.add(i);
            }
            else {
                for (let i = start; i <= end; i += step)
                    result.add(i);
            }
        }
        else {
            const val = resolveName(rangePart, min, max, nameMap);
            if (step === 1) {
                result.add(val);
            }
            else {
                // "5/15" means start at 5, step by 15
                for (let i = val; i <= max; i += step)
                    result.add(i);
            }
        }
    }
    return result;
}
function resolveName(str, min, max, nameMap) {
    const upper = str.toUpperCase().trim();
    if (nameMap && upper in nameMap)
        return nameMap[upper];
    const num = parseInt(str, 10);
    if (!Number.isFinite(num) || num < min || num > max) {
        throw new Error(`Invalid cron value: "${str}" (allowed ${min}-${max})`);
    }
    return num;
}
/**
 * Parse a 5-field cron expression into a CronFields structure.
 * Throws on invalid expression.
 */
export function parseCron(expression) {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
        throw new Error(`Cron expression must have exactly 5 fields, got ${parts.length}: "${expression}"`);
    }
    const minutes = parseField(parts[0], 0, 59);
    const hours = parseField(parts[1], 0, 23);
    const daysOfMonth = parseField(parts[2], 1, 31);
    const months = parseField(parts[3], 1, 12, MONTH_NAMES);
    const daysOfWeek = parseField(parts[4], 0, 7, DOW_NAMES);
    // Normalize: 7 = Sunday = 0
    if (daysOfWeek.has(7)) {
        daysOfWeek.add(0);
        daysOfWeek.delete(7);
    }
    if (minutes.size === 0 || hours.size === 0 || daysOfMonth.size === 0 || months.size === 0 || daysOfWeek.size === 0) {
        throw new Error(`Cron expression produced empty field set: "${expression}"`);
    }
    return { minutes, hours, daysOfMonth, months, daysOfWeek };
}
/**
 * Check if a given Date matches a parsed cron expression.
 * Optionally computes in a specific timezone.
 */
export function matchesCron(date, fields, timezone) {
    const parts = getDatePartsInTz(date, timezone);
    return (fields.minutes.has(parts.minute) &&
        fields.hours.has(parts.hour) &&
        fields.months.has(parts.month) &&
        matchesDayConstraint(parts, fields));
}
/**
 * Standard cron day matching:
 * If both DOM and DOW are restricted (not *), match if EITHER matches.
 * If only one is restricted, match that one.
 */
function matchesDayConstraint(parts, fields) {
    const domAll = fields.daysOfMonth.size === 31; // all 1-31
    const dowAll = fields.daysOfWeek.size === 7; // all 0-6
    if (domAll && dowAll)
        return true;
    if (domAll)
        return fields.daysOfWeek.has(parts.dayOfWeek);
    if (dowAll)
        return fields.daysOfMonth.has(parts.dayOfMonth);
    // Both restricted: OR semantics (standard cron)
    return fields.daysOfMonth.has(parts.dayOfMonth) || fields.daysOfWeek.has(parts.dayOfWeek);
}
function getDatePartsInTz(date, timezone) {
    if (!timezone || timezone === 'UTC') {
        return {
            minute: date.getUTCMinutes(),
            hour: date.getUTCHours(),
            dayOfMonth: date.getUTCDate(),
            month: date.getUTCMonth() + 1,
            dayOfWeek: date.getUTCDay(),
        };
    }
    // Use Intl with hourCycle:'h23' for correct 0-23 hour range (DST-safe)
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'short',
        hour12: false,
        hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(date);
    const map = {};
    for (const p of parts) {
        map[p.type] = p.value;
    }
    const DOW_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        minute: parseInt(map.minute ?? '0', 10),
        hour: parseInt(map.hour ?? '0', 10),
        dayOfMonth: parseInt(map.day ?? '1', 10),
        month: parseInt(map.month ?? '1', 10),
        dayOfWeek: DOW_MAP[map.weekday ?? 'Sun'] ?? 0,
    };
}
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
export function nextCronOccurrence(expression, after, timezone = 'UTC', maxMinutes = 527040) {
    const fields = parseCron(expression);
    return nextCronOccurrenceFromFields(fields, after, timezone, maxMinutes);
}
/**
 * Calculate next occurrence from pre-parsed fields (avoids re-parsing).
 */
export function nextCronOccurrenceFromFields(fields, after, timezone = 'UTC', maxMinutes = 527040) {
    // Snap to the next whole minute after `after`
    let candidate = new Date(after.getTime());
    candidate.setUTCSeconds(0, 0);
    candidate = new Date(candidate.getTime() + 60_000); // start at the next minute
    const end = candidate.getTime() + maxMinutes * 60_000;
    while (candidate.getTime() <= end) {
        const parts = getDatePartsInTz(candidate, timezone);
        // Skip months that don't match (jump to first day of next month)
        if (!fields.months.has(parts.month)) {
            // Advance to first day of next matching month
            candidate = advanceToNextMonth(candidate, fields.months, timezone);
            continue;
        }
        // Skip hours that don't match (jump to next matching hour)
        if (!fields.hours.has(parts.hour)) {
            candidate = new Date(candidate.getTime() + 60_000);
            continue;
        }
        // Skip days that don't match
        if (!matchesDayConstraint(parts, fields)) {
            // Advance to next day
            candidate = advanceToNextDay(candidate, timezone);
            continue;
        }
        // Check minute
        if (fields.minutes.has(parts.minute)) {
            return candidate;
        }
        // Advance one minute
        candidate = new Date(candidate.getTime() + 60_000);
    }
    return null;
}
function advanceToNextDay(date, timezone) {
    // DST-safe: advance by finding the next day boundary in the target timezone.
    // Advance 23h then scan forward minute-by-minute until the day changes.
    if (!timezone || timezone === 'UTC') {
        const next = new Date(date.getTime());
        next.setUTCHours(0, 0, 0, 0);
        return new Date(next.getTime() + 24 * 60 * 60_000);
    }
    // Get current day in timezone
    const currentParts = getDatePartsInTz(date, timezone);
    // Jump forward ~23h (safe minimum for DST)
    let candidate = new Date(date.getTime() + 23 * 60 * 60_000);
    // Then advance minute-by-minute until day changes
    for (let i = 0; i < 180; i++) { // max 3h scan
        const parts = getDatePartsInTz(candidate, timezone);
        if (parts.dayOfMonth !== currentParts.dayOfMonth || parts.month !== currentParts.month) {
            // Found the new day — snap to 00:00 in this timezone by rewinding to start of hour
            // and scanning for minute=0, hour=0
            if (parts.hour === 0 && parts.minute === 0)
                return candidate;
            // Otherwise advance to the start of the day
            candidate = new Date(candidate.getTime() + 60_000);
            continue;
        }
        candidate = new Date(candidate.getTime() + 60_000);
    }
    // Fallback: just add 24h
    return new Date(date.getTime() + 24 * 60 * 60_000);
}
function advanceToNextMonth(date, months, timezone) {
    // DST-safe month advance: use Intl to determine current month in timezone,
    // then advance to the 1st of the next matching month.
    const parts = getDatePartsInTz(date, timezone);
    let month = parts.month;
    let year = date.getUTCFullYear();
    // Approximate year from date (may differ from UTC year in edge timezones)
    const yearFormatter = timezone && timezone !== 'UTC'
        ? new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric' })
        : null;
    if (yearFormatter) {
        year = parseInt(yearFormatter.format(date), 10);
    }
    // Find next matching month
    for (let i = 0; i < 13; i++) {
        month++;
        if (month > 12) {
            month = 1;
            year++;
        }
        if (months.has(month))
            break;
    }
    // Construct a Date for the 1st of that month at 00:00 UTC, then adjust
    const d = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    return d;
}
/**
 * Validate a cron expression without calculating next occurrence.
 * Returns true if the expression is syntactically valid.
 */
export function isValidCron(expression) {
    try {
        parseCron(expression);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=cron.js.map