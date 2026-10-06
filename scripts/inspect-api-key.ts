import { pool, connectDB } from "../src/config/database.js";

async function main() {
  await connectDB();
  const cols = await pool.query(
    `SELECT column_name, data_type 
     FROM information_schema.columns 
     WHERE table_name = 'project_api_keys'`
  );
  console.log("project_api_keys columns:", cols.rows.map(r => r.column_name));

  const row = await pool.query(`SELECT * FROM project_api_keys LIMIT 1`);
  console.log("Sample key row:", row.rows[0]);

  await pool.end();
}
main().catch(console.error);
