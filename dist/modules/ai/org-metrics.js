const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MAX_LOOKBACK_MS = 90 * DAY_MS;
const UNIT_MS = {
    minute: MINUTE_MS,
    hour: HOUR_MS,
    day: DAY_MS,
    week: 7 * DAY_MS,
};
/** Parses bounded UTC monitoring ranges without sending user text to a model. */
export function parseNaturalTimeRange(question, now = new Date()) {
    if (!Number.isFinite(now.getTime()))
        return null;
    const normalized = question.toLowerCase();
    const numbered = normalized.match(/\b(?:last|past|previous)\s+(\d{1,4})\s+(minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\b/);
    if (numbered) {
        const amount = Number(numbered[1]);
        const unit = normalizeUnit(numbered[2]);
        return rollingRange(now, amount, unit, `${amount} ${pluralize(unit, amount)}`);
    }
    if (/\byesterday\b/.test(normalized))
        return previousUtcDay(now);
    if (/\btoday\b|\bthis day\b/.test(normalized))
        return currentUtcPeriod(now, 'day');
    if (/\bthis week\b/.test(normalized))
        return currentUtcPeriod(now, 'week');
    if (/\bthis month\b/.test(normalized))
        return currentUtcPeriod(now, 'month');
    if (/\b(?:previous|last) week\b/.test(normalized))
        return previousUtcPeriod(now, 'week');
    if (/\b(?:previous|last) month\b/.test(normalized))
        return previousUtcPeriod(now, 'month');
    const simple = normalized.match(/\b(?:last|past)\s+(hour|day|24 hours|7 days)\b/);
    if (simple) {
        const token = simple[1];
        const amount = token === '7 days' ? 7 : 1;
        const unit = token === 'hour' ? 'hour' : 'day';
        return rollingRange(now, amount, unit, `${amount} ${pluralize(unit, amount)}`);
    }
    return null;
}
function rollingRange(now, amount, unit, label) {
    const safeAmount = Number.isInteger(amount) && amount > 0 ? amount : 1;
    let from;
    if (unit === 'month') {
        from = new Date(now);
        from.setUTCMonth(from.getUTCMonth() - safeAmount);
    }
    else {
        from = new Date(now.getTime() - safeAmount * UNIT_MS[unit]);
    }
    const earliest = now.getTime() - MAX_LOOKBACK_MS;
    if (from.getTime() < earliest) {
        return { from: new Date(earliest), to: new Date(now), expression: 'last 90 days (maximum)' };
    }
    return { from, to: new Date(now), expression: `last ${label}` };
}
function previousUtcDay(now) {
    const to = utcDayStart(now);
    return { from: new Date(to.getTime() - DAY_MS), to, expression: 'yesterday (UTC)' };
}
function currentUtcPeriod(now, unit) {
    return { from: utcPeriodStart(now, unit), to: new Date(now), expression: `this ${unit} (UTC)` };
}
function previousUtcPeriod(now, unit) {
    const to = utcPeriodStart(now, unit);
    const from = new Date(to);
    if (unit === 'week')
        from.setUTCDate(from.getUTCDate() - 7);
    else
        from.setUTCMonth(from.getUTCMonth() - 1);
    return { from, to, expression: `previous ${unit} (UTC)` };
}
function utcPeriodStart(date, unit) {
    const start = utcDayStart(date);
    if (unit === 'week') {
        const mondayOffset = (start.getUTCDay() + 6) % 7;
        start.setUTCDate(start.getUTCDate() - mondayOffset);
    }
    else if (unit === 'month') {
        start.setUTCDate(1);
    }
    return start;
}
function utcDayStart(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function normalizeUnit(value) {
    if (/^min/.test(value))
        return 'minute';
    if (/^(hour|hr)/.test(value))
        return 'hour';
    if (/^day/.test(value))
        return 'day';
    if (/^week/.test(value))
        return 'week';
    return 'month';
}
function pluralize(unit, amount) {
    return amount === 1 ? unit : `${unit}s`;
}
//# sourceMappingURL=org-metrics.js.map