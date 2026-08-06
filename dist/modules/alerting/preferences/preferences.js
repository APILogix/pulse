export function isNotificationSuppressed(preference, now = new Date()) {
    if (!preference.enabled)
        return true;
    if (preference.vacationUntil && preference.vacationUntil > now)
        return true;
    if (preference.temporaryMuteUntil && preference.temporaryMuteUntil > now)
        return true;
    if (!preference.quietHours)
        return false;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const start = parseClock(preference.quietHours.start);
    const end = parseClock(preference.quietHours.end);
    if (start === null || end === null || start === end)
        return false;
    return start < end ? currentMinutes >= start && currentMinutes < end : currentMinutes >= start || currentMinutes < end;
}
function parseClock(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match)
        return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}
export function correlationKey(input) {
    return [input.organizationId, input.projectId ?? 'org', input.policyId, input.environment ?? 'all', input.service ?? 'all', input.dimension ?? 'all'].join(':');
}
export function digestCount(count, maxItems = 20) {
    return { collapsed: count > 1, included: Math.min(Math.max(0, count), maxItems) };
}
//# sourceMappingURL=preferences.js.map