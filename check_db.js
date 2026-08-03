const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.LOGDB_URL || process.env.DATABASE_URL });
pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'events_spans'")
  .then(res => {
    console.log(JSON.stringify(res.rows.map(r => r.column_name)));
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
