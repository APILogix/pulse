import { Client } from 'pg';

const regions = [
  'ap-south-1',
  'ap-southeast-1',
  'us-east-1',
  'us-west-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ca-central-1',
  'sa-east-1'
];

async function check() {
  for (const r of regions) {
    const host = `aws-0-${r}.pooler.supabase.com`;
    process.stdout.write(`Testing region ${r} (${host})... `);
    const client = new Client({
      host,
      port: 6543,
      user: 'postgres.dznzazqefvakycgkwivn',
      password: 'Vikas_shr2004',
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 4000
    });

    try {
      await client.connect();
      const res = await client.query('SELECT current_database(), now()');
      console.log(`SUCCESS! Connected:`, res.rows[0]);
      await client.end();
      return r;
    } catch (e: any) {
      console.log(`Failed: ${e.message}`);
      try { await client.end(); } catch (_) {}
    }
  }
}

check().catch(console.error);
