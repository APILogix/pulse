// ============================================
// USER AGENT PARSING
// ============================================
const MOBILE_REGEX = /Mobile|Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|Opera Mini/i;
const TABLET_REGEX = /Tablet|iPad|Android(?!.*Mobile)/i;
const BOT_REGEX = /bot|crawler|spider|crawling|facebookexternalhit|googlebot|bingbot|yandex/i;
const BROWSER_PATTERNS = [
    { name: 'Chrome', regex: /Chrome\/([0-9.]+)/ },
    { name: 'Firefox', regex: /Firefox\/([0-9.]+)/ },
    { name: 'Safari', regex: /Safari\/([0-9.]+)/ },
    { name: 'Edge', regex: /Edg\/([0-9.]+)/ },
    { name: 'Opera', regex: /Opera\/([0-9.]+)|OPR\/([0-9.]+)/ },
];
const OS_PATTERNS = [
    { name: 'Windows', regex: /Windows NT ([0-9.]+)/ },
    { name: 'macOS', regex: /Mac OS X ([0-9._]+)/ },
    { name: 'iOS', regex: /iPhone OS ([0-9._]+)|iOS ([0-9.]+)/ },
    { name: 'Android', regex: /Android ([0-9.]+)/ },
    { name: 'Linux', regex: /Linux/ },
];
// ============================================
// MAIN FUNCTION: getClientInfo
// ============================================
export function getClientInfo(request) {
    const userAgent = request.headers['user-agent'] || 'unknown';
    const ip = extractIp(request);
    const requestId = request.id;
    return {
        ip,
        userAgent,
        device: parseDeviceInfo(userAgent),
        location: {}, // Populated async via geoIP if needed
        requestId,
        timestamp: new Date().toISOString(),
        isMobile: MOBILE_REGEX.test(userAgent),
        isBot: BOT_REGEX.test(userAgent),
    };
}
// ============================================
// IP EXTRACTION
// ============================================
function extractIp(request) {
    // Priority order for IP extraction
    const candidates = [
        request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim(),
        request.headers['x-real-ip']?.toString(),
        request.headers['cf-connecting-ip']?.toString(), // Cloudflare
        request.ip,
        request.socket?.remoteAddress,
    ];
    for (const candidate of candidates) {
        if (candidate && isValidIp(candidate)) {
            return normalizeIp(candidate);
        }
    }
    return 'unknown';
}
function isValidIp(ip) {
    // IPv4
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    // IPv6
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}
function normalizeIp(ip) {
    // Handle IPv6-mapped IPv4
    if (ip.startsWith('::ffff:')) {
        return ip.substring(7);
    }
    return ip;
}
// ============================================
// DEVICE PARSING
// ============================================
function parseDeviceInfo(userAgent) {
    const type = detectDeviceType(userAgent);
    const browser = parseBrowser(userAgent);
    const os = parseOS(userAgent);
    return {
        type,
        browser: browser.name,
        browserVersion: browser.version,
        os: os.name,
        osVersion: os.version,
    };
}
function detectDeviceType(userAgent) {
    if (BOT_REGEX.test(userAgent))
        return 'bot';
    if (TABLET_REGEX.test(userAgent))
        return 'tablet';
    if (MOBILE_REGEX.test(userAgent))
        return 'mobile';
    return 'desktop';
}
function parseBrowser(userAgent) {
    for (const pattern of BROWSER_PATTERNS) {
        const match = userAgent.match(pattern.regex);
        if (match) {
            return {
                name: pattern.name,
                version: match[1] || match[2] || 'unknown',
            };
        }
    }
    return { name: 'unknown', version: 'unknown' };
}
function parseOS(userAgent) {
    for (const pattern of OS_PATTERNS) {
        const match = userAgent.match(pattern.regex);
        if (match) {
            return {
                name: pattern.name,
                version: match[1]?.replace(/_/g, '.') || 'unknown',
            };
        }
    }
    return { name: 'unknown', version: 'unknown' };
}
// ============================================
// ASYNC GEOLOCATION (Optional)
// ============================================
export async function enrichLocationInfo(clientInfo) {
    // Use free geoip service or database
    // Example: MaxMind GeoLite2, ipapi.co, or ipgeolocation.io
    try {
        // Free tier: ipapi.co (45 requests/minute)
        const response = await fetch(`https://ipapi.co/${clientInfo.ip}/json/`);
        const data = await response.json();
        if (!data.error) {
            clientInfo.location = {
                country: data.country_name,
                region: data.region,
                city: data.city,
                timezone: data.timezone,
                latitude: data.latitude,
                longitude: data.longitude,
            };
        }
    }
    catch (err) {
        // Silently fail - location is optional
    }
    return clientInfo;
}
// ============================================
// SECURITY HELPERS
// ============================================
export function isSuspiciousRequest(clientInfo, userContext) {
    const checks = [
        // Bot accessing authenticated endpoint
        clientInfo.isBot && !!userContext,
        // Mobile device with desktop browser signature
        clientInfo.device.type === 'mobile' && clientInfo.device.browser === 'Edge',
        // Missing user agent
        clientInfo.userAgent === 'unknown',
        // Known datacenter IP (would need IP database)
        // clientInfo.ip.startsWith('...')
    ];
    return checks.some(Boolean);
}
export function generateRequestFingerprint(clientInfo) {
    // Unique fingerprint for rate limiting / fraud detection
    const components = [
        clientInfo.ip,
        clientInfo.device.browser,
        clientInfo.device.os,
        clientInfo.userAgent.slice(0, 50), // First 50 chars
    ];
    return components.join('|');
}
// ============================================
// LOGGING FORMATTER
// ============================================
export function formatRequestLog(request, clientInfo, durationMs) {
    return {
        requestId: clientInfo.requestId,
        timestamp: clientInfo.timestamp,
        method: request.method,
        url: request.url,
        route: request.routerPath,
        statusCode: request.statusCode,
        durationMs,
        client: {
            ip: clientInfo.ip,
            device: clientInfo.device.type,
            browser: clientInfo.device.browser,
            os: clientInfo.device.os,
            isMobile: clientInfo.isMobile,
            isBot: clientInfo.isBot,
            country: clientInfo.location.country,
        },
        user: request.user?.id,
        userAgent: clientInfo.userAgent.slice(0, 200), // Truncate
    };
}
// ============================================
// FASTIFY DECORATOR
// ============================================
import fp from 'fastify-plugin';
export const clientInfoPlugin = fp(async (fastify) => {
    fastify.decorateRequest('clientInfo', null);
    fastify.addHook('onRequest', async (request) => {
        request.clientInfo = getClientInfo(request);
    });
});
//# sourceMappingURL=request.js.map