import pg from 'pg';
import fs from 'fs';
import { env } from './src/config/env.js';

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

async function dump() {
  const resTraces = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'events_traces'
  `);
  
  const resSpans = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'events_spans'
  `);

  fs.writeFileSync('schema_traces.json', JSON.stringify(resTraces.rows, null, 2));
  fs.writeFileSync('schema_spans.json', JSON.stringify(resSpans.rows, null, 2));
  
  await pool.end();
}

dump().catch(console.error);
