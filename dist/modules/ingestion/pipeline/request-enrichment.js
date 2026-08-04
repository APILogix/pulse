/**
 * Request enrichment — turns the two raw signals the SDK already sends
 * (`clientIp`, `userAgent`) into the lightweight, low-cardinality columns stored
 * on events_requests (migration 14_observability/015). Enrichment happens HERE,
 * at ingestion, never in the SDK.
 *
 *   clientIp   --GeoIP-->  geo_country_code, geo_region, geo_asn
 *   clientIp   --hash-->   client_ip_hash          (privacy-preserving identity)
 *   userAgent  --parse-->  browser_family, browser_version_major,
 *                          os_name, os_version_major, device_type, is_bot
 *
 * Design:
 *   - Everything degrades gracefully: if the GeoIP database is not configured or
 *     the optional `maxmind` package is not installed, geo fields resolve to
 *     null and ingestion continues (NULL == "Unknown" for dashboards). This
 *     matches the writer's "never fail an insert on missing enrichment" rule.
 *   - UA parsing is dependency-free (bounded regex) so it always works offline.
 *   - Wide descriptive strings (country name, ISP/org) are NOT produced here;
 *     they live in geo_countries / geo_networks and are resolved at query time.
 *
 * Configuration (env):
 *   PULSE_GEOIP_CITY_DB  absolute path to a MaxMind GeoLite2-City .mmdb
 *   PULSE_GEOIP_ASN_DB   absolute path to a MaxMind GeoLite2-ASN  .mmdb
 *   PULSE_IP_HASH_SALT   salt for client_ip_hash (defaults to a static dev salt)
 */
import { createHash } from 'crypto';
import { UAParser } from 'ua-parser-js';
const EMPTY = {
    geoCountryCode: null,
    geoRegion: null,
    geoAsn: null,
    clientIpHash: null,
    browserFamily: null,
    browserVersionMajor: null,
    osName: null,
    osVersionMajor: null,
    deviceType: null,
    isBot: null,
};
export class RequestEnricher {
    static shared = null;
    cityReader = null;
    asnReader = null;
    geoReady = false;
    initPromise = null;
    salt;
    constructor() {
        this.salt = process.env.PULSE_IP_HASH_SALT ?? 'pulse-dev-ip-salt';
    }
    /** Process-wide singleton (GeoIP readers are expensive to open). */
    static get() {
        if (!RequestEnricher.shared)
            RequestEnricher.shared = new RequestEnricher();
        return RequestEnricher.shared;
    }
    /**
     * Lazily open the MaxMind databases if configured. Safe to call repeatedly;
     * only the first call does work. Never throws — a failure just disables geo.
     */
    async init() {
        if (this.geoReady || this.initPromise)
            return this.initPromise ?? Promise.resolve();
        this.initPromise = (async () => {
            const cityPath = process.env.PULSE_GEOIP_CITY_DB;
            const asnPath = process.env.PULSE_GEOIP_ASN_DB;
            if (!cityPath && !asnPath) {
                this.geoReady = true; // nothing to load; geo stays disabled
                return;
            }
            try {
                // Non-literal specifier keeps this optional: no compile-time dependency
                // on `maxmind`; if it isn't installed the import throws and geo stays off.
                const pkg = 'maxmind';
                const mod = await import(pkg);
                if (cityPath)
                    this.cityReader = await mod.open(cityPath);
                if (asnPath)
                    this.asnReader = await mod.open(asnPath);
            }
            catch {
                this.cityReader = null;
                this.asnReader = null;
            }
            finally {
                this.geoReady = true;
            }
        })();
        return this.initPromise;
    }
    /** Enrich a single request. Synchronous; call init() once beforehand. */
    enrich(clientIp, userAgent) {
        const ip = typeof clientIp === 'string' && clientIp.length > 0 ? clientIp : null;
        const ua = typeof userAgent === 'string' && userAgent.length > 0 ? userAgent : null;
        const out = { ...EMPTY };
        if (ip) {
            out.clientIpHash = createHash('sha256').update(this.salt).update(ip).digest('hex');
            this.resolveGeo(ip, out);
        }
        if (ua)
            this.parseUserAgent(ua, out);
        return out;
    }
    // ── GeoIP ──────────────────────────────────────────────────────────────────
    resolveGeo(ip, out) {
        try {
            if (this.cityReader) {
                const rec = this.cityReader.get(ip);
                if (rec) {
                    out.geoCountryCode = rec.country?.iso_code?.slice(0, 2) ?? null;
                    const sub = rec.subdivisions?.[0];
                    out.geoRegion = (sub?.names?.en ?? sub?.iso_code ?? null)?.slice(0, 100) ?? null;
                }
            }
            if (this.asnReader) {
                const rec = this.asnReader.get(ip);
                const asn = rec?.autonomous_system_number;
                out.geoAsn = typeof asn === 'number' && Number.isFinite(asn) ? asn : null;
            }
        }
        catch {
            /* geo lookup failure is non-fatal */
        }
    }
    // ── User-Agent parsing (ua-parser-js) ────────────────────────────────────────
    parseUserAgent(ua, out) {
        const s = ua.slice(0, 1024);
        try {
            // Fast heuristic for common bots to save parser overhead for simple cases
            if (/bot|crawler|spider|crawling|slurp|mediapartners|headlesschrome|facebookexternalhit|preview/i.test(s)) {
                out.isBot = true;
                out.deviceType = 'bot';
                out.browserFamily = 'Bot';
                return;
            }
            const parser = new UAParser(s);
            const parsed = parser.getResult();
            // Bot detection from ua-parser-js (if any)
            if (parsed.browser.name?.toLowerCase().includes('bot') || parsed.browser.name?.toLowerCase().includes('crawler')) {
                out.isBot = true;
                out.deviceType = 'bot';
                out.browserFamily = 'Bot';
                return;
            }
            out.isBot = false;
            // Browser
            out.browserFamily = parsed.browser.name ?? null;
            if (parsed.browser.version) {
                const major = parseInt(parsed.browser.version.split('.')[0], 10);
                out.browserVersionMajor = Number.isFinite(major) && !Number.isNaN(major) ? major : null;
            }
            else {
                out.browserVersionMajor = null;
            }
            // OS
            out.osName = parsed.os.name ?? null;
            if (parsed.os.version) {
                // macOS could be 10.15, iOS 18.0
                const major = parseInt(parsed.os.version.split(/[._]/)[0], 10);
                out.osVersionMajor = Number.isFinite(major) && !Number.isNaN(major) ? major : null;
            }
            else {
                out.osVersionMajor = null;
            }
            // iOS WebView/App Fallback (often lacks "Safari" in UA string)
            if (out.osName === 'iOS' && !out.browserFamily) {
                out.browserFamily = 'Safari';
                out.browserVersionMajor = out.osVersionMajor;
            }
            // Standardize OS naming to match previous normalization (for backwards compat in querying)
            if (out.osName === 'Mac OS')
                out.osName = 'macOS';
            if (out.osName === 'Chrome OS' || out.osName === 'Chromium OS')
                out.osName = 'ChromeOS';
            // Device Type
            if (parsed.device.type === 'mobile') {
                out.deviceType = 'mobile';
            }
            else if (parsed.device.type === 'tablet') {
                out.deviceType = 'tablet';
            }
            else if (parsed.device.type === 'smarttv' || parsed.device.type === 'console' || parsed.device.type === 'wearable' || parsed.device.type === 'embedded') {
                out.deviceType = 'unknown'; // we only support desktop/mobile/tablet/bot/unknown
            }
            else {
                // UAParser often leaves device.type empty for desktop, so we infer it from the OS
                if (out.osName === 'Windows' || out.osName === 'macOS' || out.osName === 'Linux' || out.osName === 'ChromeOS' || out.osName === 'Ubuntu') {
                    out.deviceType = 'desktop';
                }
                else {
                    out.deviceType = 'unknown';
                }
            }
        }
        catch (err) {
            // In case of parsing failure, we fail gracefully and leave fields as NULL.
            // This strictly follows the requirement: "Never prevent insertion into event_requests"
        }
    }
}
//# sourceMappingURL=request-enrichment.js.map