import { pool, connectDB } from "../src/config/database.js";

async function main() {
  await connectDB();
  const indexes = await pool.query(
    `SELECT indexname, indexdef 
     FROM pg_indexes 
     WHERE tablename = 'project_api_keys'`
  );
  console.log("Indexes on project_api_keys:");
  for (const idx of indexes.rows) {
    console.log(`- ${idx.indexname}: ${idx.indexdef}`);
  }
  await pool.end();
}
main().catch(console.error);
