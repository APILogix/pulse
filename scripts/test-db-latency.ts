import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { env } from '../src/config/env.js';
import { resolvePostgresSslConfig, sanitizePostgresConnectionString } from '../src/config/postgres-ssl.js';
import { withPostgresAddressFamily } from '../src/config/postgres-network.js';

interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  p95: number;
  samples: number[];
}

function computeStats(samples: number[]): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p95 = sorted[p95Index];
  return { min, max, avg, p95, samples };
}

async function measureTcp(host: string, port = 5432): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const socket = net.connect(port, host, () => {
      const elapsed = performance.now() - start;
      socket.end();
      resolve(elapsed);
    });
    socket.setTimeout(10000, () => {
      socket.destroy();
      reject(new Error('TCP connect timeout (10s)'));
    });
    socket.on('error', (err) => reject(err));
  });
}

async function benchmarkDatabase(label: string, connectionString: string) {
  const parsed = new URL(connectionString);
  const host = parsed.hostname;
  const port = Number(parsed.port || '5432');

  console.log(`\n======================================================`);
  console.log(`Latency Benchmark: ${label}`);
  console.log(`Target: ${host}:${port} (${parsed.pathname.slice(1)})`);
  console.log(`======================================================`);

  // 1. Raw TCP Round-Trip Latency
  console.log('\n[1/4] Measuring Raw TCP Network RTT...');
  const tcpSamples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const ms = await measureTcp(host, port);
    tcpSamples.push(ms);
  }
  const tcpStats = computeStats(tcpSamples);
  console.log(`  TCP Connect RTT: avg=${tcpStats.avg.toFixed(1)}ms | min=${tcpStats.min.toFixed(1)}ms | max=${tcpStats.max.toFixed(1)}ms`);

  // 2. TLS + Auth Handshake (Pool Checkout)
  console.log('\n[2/4] Measuring Initial Pool Handshake (TCP + TLS + Auth)...');
  const pool = new Pool(withPostgresAddressFamily({
    connectionString: sanitizePostgresConnectionString(connectionString),
    max: 2,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 15000,
    ssl: resolvePostgresSslConfig(connectionString),
  }, env.DB_FAMILY));

  const handshakeStart = performance.now();
  const client = await pool.connect();
  const handshakeElapsed = performance.now() - handshakeStart;
  console.log(`  Initial Handshake Latency: ${handshakeElapsed.toFixed(1)}ms`);

  // 3. Warm Query Round-Trips (10 pings)
  console.log('\n[3/4] Measuring Warm Query Latency (10 round-trips over established connection)...');
  const pingSamples: number[] = [];
  for (let i = 0; i < 10; i++) {
    const pingStart = performance.now();
    await client.query('SELECT 1;');
    const pingElapsed = performance.now() - pingStart;
    pingSamples.push(pingElapsed);
  }
  const pingStats = computeStats(pingSamples);
  console.log(`  Warm 'SELECT 1' Latency: avg=${pingStats.avg.toFixed(1)}ms | min=${pingStats.min.toFixed(1)}ms | max=${pingStats.max.toFixed(1)}ms | p95=${pingStats.p95.toFixed(1)}ms`);

  // 4. Real Schema / Table Query Latency
  console.log('\n[4/4] Measuring Real Table Query Latency...');
  const queryStart = performance.now();
  const tableCountRes = await client.query(`
    SELECT count(*)::int as count FROM information_schema.tables WHERE table_schema = 'public';
  `);
  const queryElapsed = performance.now() - queryStart;
  console.log(`  Information Schema Query: ${queryElapsed.toFixed(1)}ms (Found ${tableCountRes.rows[0].count} public tables)`);

  client.release();
  await pool.end();

  return { tcpStats, handshakeElapsed, pingStats, queryElapsed };
}

async function main() {
  console.log('Testing Database Latency to Singapore (aws-ap-southeast-1)...');
  
  if (env.DATABASE_URL) {
    await benchmarkDatabase('Primary DB (Singapore)', env.DATABASE_URL);
  }
  if (env.LOG_DB_PRIMARY) {
    await benchmarkDatabase('Log DB Primary (Singapore)', env.LOG_DB_PRIMARY);
  }
  console.log('\n======================================================');
  console.log('Latency Benchmark Complete!');
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
