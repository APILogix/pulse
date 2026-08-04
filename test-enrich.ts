import { z } from 'zod';
import { UAParser } from 'ua-parser-js';
import { normalizeEvent } from './src/modules/ingestion/pipeline/event-normalizer.js';
import { RequestEnricher } from './src/modules/ingestion/pipeline/request-enrichment.js';

async function test() {
  const rawEvent = {
    type: 'request',
    requestId: 'req-1',
    url: '/api/v1/users',
    method: 'GET',
    statusCode: 200,
    latency: 150,
    timestamp: Date.now(),
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    clientIp: '1.2.3.4'
  };

  const normalized = normalizeEvent(rawEvent);
  console.log('Normalized Event:', normalized);

  const enricher = RequestEnricher.get();
  await enricher.init();

  const r = normalized as any;
  const g = enricher.enrich(r.event.clientIp, r.event.userAgent);
  console.log('Enriched Data:', g);
}

test().catch(console.error);
