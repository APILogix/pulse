// ============================================
// USER AGENT PARSING
// ============================================
const MOBILE_REGEX = /Mobile|Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|Opera Mini/i;
const TABLET_REGEX = /Tablet|iPad|Android(?!.*Mobile)/i;
const BOT_REGEX = /bot|crawler|spider|crawling|facebookexternalhit|googlebot|bingbot|yandex/i;
const BROWSER_PATTERNS = [
    { name: 'Edge', regex: /Edg\/([0-9.]+)/ }, // Must match before Chrome
    { name: 'Opera', regex: /OPR\/([0-9.]+)|Opera\/([0-9.]+)/ },
    { name: 'Chrome', regex: /Chrome\/([0-9.]+)/ },
    { name: 'Firefox', regex: /Firefox\/([0-9.]+)/ },
    { name: 'Safari', regex: /Version\/([0-9.]+).*Safari/ },
];
const OS_PATTERNS = [
    { name: 'Windows', regex: /Windows NT ([0-9.]+)/ },
    { name: 'macOS', regex: /Mac OS X ([0-9._]+)/ },
    { name: 'iOS', regex: /iPhone OS ([0-9._]+)|iOS ([0-9.]+)/ },
    { name: 'Android', regex: /Android ([0-9.]+)/ },
    { name: 'Linux', regex: /Linux/ },
];
// ============================================
// MAIN FUNCTION
// ============================================
export function getClientInfo(request) {
    const userAgent = typeof request.headers['user-agent'] === 'string'
        ? request.headers['user-agent']
        : 'unknown';
    return {
        ip: normalizeIp(request.ip || 'unknown'),
        userAgent: userAgent.slice(0, 1024), // bounded
        device: parseDeviceInfo(userAgent),
        requestId: request.id,
        timestamp: new Date().toISOString(),
        isMobile: MOBILE_REGEX.test(userAgent),
        isBot: BOT_REGEX.test(userAgent),
    };
}
// ============================================
// IP NORMALIZATION (no source rewriting; only normalize formatting)
// ============================================
function normalizeIp(ip) {
    // IPv6-mapped IPv4 → bare IPv4. INET columns accept both, but downstream
    // tooling is happier with the canonical form.
    if (ip.startsWith('::ffff:')) {
        return ip.substring(7);
    }
    return ip;
}
// ============================================
// DEVICE PARSING
// ============================================
function parseDeviceInfo(userAgent) {
    return {
        type: detectDeviceType(userAgent),
        ...parseBrowser(userAgent),
        ...parseOS(userAgent),
    };
}
function detectDeviceType(userAgent) {
    if (BOT_REGEX.test(userAgent))
        return 'bot';
    if (TABLET_REGEX.test(userAgent))
        return 'tablet';
    if (MOBILE_REGEX.test(userAgent))
        return 'mobile';
    if (userAgent && userAgent !== 'unknown')
        return 'desktop';
    return 'unknown';
}
function parseBrowser(userAgent) {
    for (const pattern of BROWSER_PATTERNS) {
        const match = userAgent.match(pattern.regex);
        if (match) {
            return {
                browser: pattern.name,
                browserVersion: match[1] || match[2] || 'unknown',
            };
        }
    }
    return { browser: 'unknown', browserVersion: 'unknown' };
}
function parseOS(userAgent) {
    for (const pattern of OS_PATTERNS) {
        const match = userAgent.match(pattern.regex);
        if (match) {
            return {
                os: pattern.name,
                osVersion: (match[1] || match[2] || 'unknown').replace(/_/g, '.'),
            };
        }
    }
    return { os: 'unknown', osVersion: 'unknown' };
}
// ============================================
// FASTIFY DECORATOR (optional convenience plugin)
// ============================================
import fp from 'fastify-plugin';
export const clientInfoPlugin = fp(async (fastify) => {
    fastify.decorateRequest('clientInfo', null);
    fastify.addHook('onRequest', async (request) => {
        request.clientInfo = getClientInfo(request);
    });
});
//# sourceMappingURL=request.js.map