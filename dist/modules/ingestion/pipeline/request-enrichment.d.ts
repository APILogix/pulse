export interface EnrichedRequestFields {
    geoCountryCode: string | null;
    geoRegion: string | null;
    geoAsn: number | null;
    clientIpHash: string | null;
    browserFamily: string | null;
    browserVersionMajor: number | null;
    osName: string | null;
    osVersionMajor: number | null;
    deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown' | null;
    isBot: boolean | null;
}
export declare class RequestEnricher {
    private static shared;
    private cityReader;
    private asnReader;
    private geoReady;
    private initPromise;
    private readonly salt;
    private constructor();
    /** Process-wide singleton (GeoIP readers are expensive to open). */
    static get(): RequestEnricher;
    /**
     * Lazily open the MaxMind databases if configured. Safe to call repeatedly;
     * only the first call does work. Never throws — a failure just disables geo.
     */
    init(): Promise<void>;
    /** Enrich a single request. Synchronous; call init() once beforehand. */
    enrich(clientIp: unknown, userAgent: unknown): EnrichedRequestFields;
    private resolveGeo;
    private parseUserAgent;
}
//# sourceMappingURL=request-enrichment.d.ts.map