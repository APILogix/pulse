/**
 * analytics.geo — country/region traffic plus browser/OS/device breakdowns.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.14
 * Metrics: docs/analytics/10-analytics-catalog.md §12
 *
 * Reads  : events_requests (geo_country_code, geo_region, browser_family, os_name, device_type)
 * Writes : geo_metrics_1h, device_metrics_1h
 *
 * This worker is what replaces `countryForIp()` and `bucketUserAgent()` — the
 * frontend's first-IP-octet geography and browser regex
 * (docs/analytics/02-dummy-data-audit.md §2).
 */
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
export declare function createGeoWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=geo.worker.d.ts.map