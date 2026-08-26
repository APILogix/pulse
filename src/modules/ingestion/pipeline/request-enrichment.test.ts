import { describe, expect, it } from 'vitest';
import { RequestEnricher } from './request-enrichment.js';

describe('RequestEnricher', () => {
  it('preserves both IP-derived and user-agent-derived fields when cached', () => {
    const enricher = RequestEnricher.get();
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const first = enricher.enrich('203.0.113.10', ua);
    const second = enricher.enrich('203.0.113.10', ua);

    for (const enriched of [first, second]) {
      expect(enriched.clientIpHash).toHaveLength(64);
      expect(enriched.browserFamily).toBeTruthy();
      expect(enriched.osName).toBeTruthy();
      expect(enriched.isBot).toBe(false);
    }
  });

  it('short-circuits common bot user agents without losing IP hash', () => {
    const enriched = RequestEnricher.get().enrich('203.0.113.11', 'Googlebot/2.1 (+http://www.google.com/bot.html)');

    expect(enriched.clientIpHash).toHaveLength(64);
    expect(enriched.browserFamily).toBe('Bot');
    expect(enriched.deviceType).toBe('bot');
    expect(enriched.isBot).toBe(true);
  });
});
