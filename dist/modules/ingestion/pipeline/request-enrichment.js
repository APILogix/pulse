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
    // ── User-Agent parsing (dependency-free) ─────────────────────────────────────
    parseUserAgent(ua, out) {
        const s = ua.slice(0, 1024);
        // Bots first (also covers headless + common crawlers).
        if (/bot|crawler|spider|crawling|slurp|mediapartners|headlesschrome|facebookexternalhit|preview/i.test(s)) {
            out.isBot = true;
            out.deviceType = 'bot';
            out.browserFamily = 'Bot';
            return;
        }
        out.isBot = false;
        // OS.
        const os = this.matchOs(s);
        out.osName = os.name;
        out.osVersionMajor = os.major;
        // Browser (order matters: Edge/Opera/Brave masquerade as Chrome).
        const br = this.matchBrowser(s);
        out.browserFamily = br.name;
        out.browserVersionMajor = br.major;
        // Device class.
        out.deviceType = this.matchDevice(s, os.name);
    }
    matchOs(s) {
        let m;
        if ((m = s.match(/Windows NT (\d+)/i))) {
            // NT 10.0 -> Windows 10/11; we store the NT major as-is for fidelity.
            return { name: 'Windows', major: parseInt(m[1], 10) };
        }
        if ((m = s.match(/Android (\d+)/i)))
            return { name: 'Android', major: parseInt(m[1], 10) };
        if ((m = s.match(/(?:iPhone OS|CPU OS) (\d+)/i)))
            return { name: 'iOS', major: parseInt(m[1], 10) };
        if ((m = s.match(/Mac OS X (\d+)[._](\d+)/i)))
            return { name: 'macOS', major: parseInt(m[1], 10) };
        if (/CrOS/i.test(s))
            return { name: 'ChromeOS', major: null };
        if (/Linux/i.test(s))
            return { name: 'Linux', major: null };
        return { name: null, major: null };
    }
    matchBrowser(s) {
        const pick = (re, name) => {
            const m = s.match(re);
            return m ? { name, major: m[1] ? parseInt(m[1], 10) : null } : null;
        };
        return (pick(/Edg(?:e|A|iOS)?\/(\d+)/i, 'Edge') ??
            pick(/OPR\/(\d+)/i, 'Opera') ??
            pick(/(?:Opera)\/(\d+)/i, 'Opera') ??
            pick(/SamsungBrowser\/(\d+)/i, 'Samsung Internet') ??
            pick(/Firefox\/(\d+)/i, 'Firefox') ??
            // Chrome must come before Safari (Chrome UA also contains "Safari").
            pick(/Chrome\/(\d+)/i, 'Chrome') ??
            pick(/Version\/(\d+)[.\d]* Safari/i, 'Safari') ??
            pick(/Safari\/(\d+)/i, 'Safari') ??
            { name: null, major: null });
    }
    matchDevice(s, osName) {
        if (/iPad|Tablet/i.test(s) || (osName === 'Android' && !/Mobile/i.test(s)))
            return 'tablet';
        if (/Mobi|iPhone|Android.+Mobile|Windows Phone/i.test(s))
            return 'mobile';
        if (osName === 'Windows' || osName === 'macOS' || osName === 'Linux' || osName === 'ChromeOS')
            return 'desktop';
        return 'unknown';
    }
}
//# sourceMappingURL=request-enrichment.js.map