require('dotenv').config();
const { Client } = require('pg');
(async () => {
  for (const [label, url] of [['DATABASE_URL (primary)', process.env.DATABASE_URL], ['LOG_DB_PRIMARY', process.env.LOG_DB_PRIMARY]]) {
    try {
      const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
      await c.connect();
      const host = new URL(url).hostname;
      const dbSize = await c.query(`SELECT current_database() AS db, pg_size_pretty(pg_database_size(current_database())) AS size`);
      console.log(`${label}: host=${host} db=${dbSize.rows[0].db} size=${dbSize.rows[0].size}`);
      await c.end();
    } catch (e) {
      console.log(`${label}: ERROR ${e.message}`);
    }
  }
})();
