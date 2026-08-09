import { createHash } from 'node:crypto';
export const ERROR_FINGERPRINT_VERSION = 2;
export const SEVERITY_RANK = {
    debug: 0,
    info: 1,
    warning: 2,
    error: 3,
    critical: 4,
    fatal: 5,
};
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizePath(value) {
    let normalized = value.replace(/\\/g, '/').trim();
    normalized = normalized.replace(/[?#].*$/, '');
    normalized = normalized.replace(/^file:\/\/+/, '');
    normalized = normalized.replace(/^https?:\/\/[^/]+\//i, '');
    normalized = normalized.replace(/^(?:[A-Za-z]:\/|\/)+/, '');
    normalized = normalized.replace(/^(?:workspace|app|repo|project)\//i, '');
    normalized = normalized.replace(/\/+/g, '/');
    return normalized || '<unknown-file>';
}
function normalizeFunction(value) {
    const normalized = value
        .replace(/\s+/g, ' ')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .replace(/^async\s+/, '')
        .trim();
    return normalized || '<anonymous>';
}
function numericLine(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0)
        return String(value);
    if (typeof value === 'string' && /^\d+$/.test(value.trim()))
        return String(Number(value));
    return '?';
}
function isInApp(frame) {
    return frame.inApp === true || frame.in_app === true;
}
export function normalizeStackFrames(frames) {
    if (!Array.isArray(frames))
        return [];
    return frames
        .filter((frame) => Boolean(frame && typeof frame === 'object'))
        .filter(isInApp)
        .map((frame) => {
        const file = normalizePath(text(frame.filename) || text(frame.file) || text(frame.module));
        const fn = normalizeFunction(text(frame.function) || text(frame.functionName));
        const line = numericLine(frame.lineno ?? frame.lineNumber);
        return `${file}|${fn}|${line}`;
    });
}
export function computeErrorFingerprint(errorType, frames) {
    const normalizedType = text(errorType) || 'UnknownError';
    const normalizedFrames = normalizeStackFrames(frames);
    const canonical = normalizedFrames.length > 0
        ? normalizedFrames.join('|')
        : '<no-in-app-frame>';
    const material = `v${ERROR_FINGERPRINT_VERSION}|${normalizedType}|${canonical}`;
    return createHash('sha256').update(material).digest('hex');
}
export function severityRank(severity) {
    const value = text(severity).toLowerCase();
    return SEVERITY_RANK[value] ?? 3;
}
export function normalizeSeverity(severity) {
    const value = text(severity).toLowerCase();
    if (value === 'warn')
        return 'warning';
    if (value === 'critical')
        return 'critical';
    if (value === 'fatal')
        return 'fatal';
    return Object.prototype.hasOwnProperty.call(SEVERITY_RANK, value) ? value : 'error';
}
function parseSemver(value) {
    if (!value)
        return null;
    const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    if (!match)
        return null;
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ''];
}
export function compareReleases(left, right) {
    const a = parseSemver(left);
    const b = parseSemver(right);
    if (!a || !b)
        return null;
    for (const [leftPart, rightPart] of [[a[0], b[0]], [a[1], b[1]], [a[2], b[2]]]) {
        if (leftPart !== rightPart)
            return leftPart > rightPart ? 1 : -1;
    }
    if (a[3] === b[3])
        return 0;
    if (!a[3])
        return 1;
    if (!b[3])
        return -1;
    return a[3] > b[3] ? 1 : -1;
}
export function isReleaseEligible(incomingRelease, resolvedRelease) {
    const comparison = compareReleases(incomingRelease, resolvedRelease);
    return comparison !== null && comparison >= 0;
}
//# sourceMappingURL=fingerprint.js.map