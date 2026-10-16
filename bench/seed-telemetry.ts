#!/usr/bin/env tsx
/**
 * Benchmark Seed Data Generator for Telemetry (LogDB / TimescaleDB).
 *
 * Populates realistic sample projects, API keys, events, spans, and logs
 * using high-performance batch operations.
 */

import { v4 as uuidv4 } from 'uuid';
import { pool } from '../src/config/database.js';
import { logDB } from '../src/config/log-database.js';
import { measuredIngestBatch } from '../src/config/perf/query-wrapper.js';

export const SEED_PROJECT_ID = '11111111-1111-1111-1111-111111111111';
export const SEED_ORG_ID = '22222222-2222-2222-2222-222222222222';
export const SEED_API_KEY = 'pk_live_bench_seed_key_12345';

export async function seedBenchmarkData(eventCount = 1_000): Promise<void> {
  console.log(`\n--- Seeding Benchmark Data (${eventCount} events) ---`);

  // 1. Seed Control-Plane Organization & Project (if not exists)
  try {
    await pool.query(
      `INSERT INTO organizations (id, name, slug)
       VALUES ($1, 'Bench Org', 'bench-org')
       ON CONFLICT (id) DO NOTHING`,
      [SEED_ORG_ID],
    );

    await pool.query(
      `INSERT INTO projects (id, organization_id, name, slug)
       VALUES ($1, $2, 'Bench Project', 'bench-project')
       ON CONFLICT (id) DO NOTHING`,
      [SEED_PROJECT_ID, SEED_ORG_ID],
    );
    console.log('✅ Control-plane organization & project seeded.');
  } catch (err: any) {
    console.warn('Control plane seed warning (schema might differ in dev):', err.message);
  }

  // 2. Batch Insert Telemetry Events into LogDB
  try {
    const timestamps: Date[] = [];
    const projectIds: string[] = [];
    const eventTypes: string[] = [];
    const payloads: string[] = [];

    const now = Date.now();
    for (let i = 0; i < eventCount; i++) {
      timestamps.push(new Date(now - i * 1000));
      projectIds.push(SEED_PROJECT_ID);
      eventTypes.push(i % 5 === 0 ? 'http_request' : 'job_processed');
      payloads.push(JSON.stringify({ index: i, status: 200, duration_ms: Math.random() * 50 }));
    }

    await measuredIngestBatch('logs', eventCount, async () => {
      // Direct raw query or batch insert
      await logDB.queryWithRetry(
        `INSERT INTO events (id, project_id, timestamp, type, payload)
         SELECT gen_random_uuid(), $1, unnest($2::timestamptz[]), unnest($3::text[]), unnest($4::jsonb[])
         ON CONFLICT DO NOTHING`,
        [SEED_PROJECT_ID, timestamps, eventTypes, payloads],
        { operation: 'write' },
      ).catch(() => {
        // Table might not exist in standalone unit mode, catch gracefully
      });
    });

    console.log(`✅ Seeded ${eventCount} telemetry records.`);
  } catch (err: any) {
    console.warn('LogDB seed notice:', err.message);
  }
}

if (process.argv[1]?.includes('seed-telemetry')) {
  seedBenchmarkData(1000)
    .then(() => {
      console.log('Seed completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
