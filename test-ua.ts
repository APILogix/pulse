import { RequestEnricher } from './src/modules/ingestion/pipeline/request-enrichment.js';

const enricher = RequestEnricher.get();
await enricher.init();

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  'Googlebot/2.1 (+http://www.google.com/bot.html)',
  'curl/7.81.0',
];

for (const ua of userAgents) {
  const result = enricher.enrich('127.0.0.1', ua);
  console.log('---');
  console.log(`Raw UA: ${ua}`);
  console.log(`Browser: ${result.browserFamily} ${result.browserVersionMajor}`);
  console.log(`OS: ${result.osName} ${result.osVersionMajor}`);
  console.log(`Device: ${result.deviceType}`);
  console.log(`Bot: ${result.isBot}`);
}
