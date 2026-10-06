#!/usr/bin/env tsx
/**
 * Test Log DB connection
 */
import { config } from 'dotenv';
import { Pool } from 'pg';

import '../src/config/dns.js';
import { resolvePostgresSslConfig, sanitizePostgresConnectionString } from '../src/config/postgres-ssl.js';

config();

async function testConnection() {
  const connectionString = process.env.LOG_DB_PRIMARY;
  
  console.log('Testing Log DB connection...');
  console.log('Connection string:', connectionString?.replace(/:([^:@]+)@/, ':****@'));
  
  if (!connectionString) {
    throw new Error('LOG_DB_PRIMARY is not set');
  }

  const sanitized = sanitizePostgresConnectionString(connectionString);
  const ssl = resolvePostgresSslConfig(connectionString, {
    enabled: process.env.LOG_DB_SSL_ENABLED === 'true',
    rejectUnauthorized: process.env.LOG_DB_SSL_REJECT_UNAUTHORIZED === 'true',
  });

  const pool = new Pool({
    connectionString: sanitized,
    max: 1,
    connectionTimeoutMillis: 15000,
    ssl,
  });

  try {
    console.log('\nAttempting to connect...');
    const startTime = Date.now();
    
    const client = await pool.connect();
    const elapsed = Date.now() - startTime;
    
    console.log(`✅ Connected successfully in ${elapsed}ms`);
    
    const result = await client.query('SELECT version(), current_database(), current_user');
    console.log('\nDatabase Info:');
    console.log('  Version:', result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1]);
    console.log('  Database:', result.rows[0].current_database);
    console.log('  User:', result.rows[0].current_user);
    
    const tablesResult = await client.query(`
      SELECT count(*) as table_count 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('  Tables:', tablesResult.rows[0].table_count);
    
    client.release();
    console.log('\n✅ Connection test passed!');
  } catch (error) {
    console.error('\n❌ Connection test failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testConnection().catch((error) => {
  console.error('Test failed:', error.message);
  process.exit(1);
});
