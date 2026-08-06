const { Client } = require('pg');

async function testQueries() {
  const client = new Client({ connectionString: 'postgresql://postgres:vikas1234@localhost:5432/logdb' });
  await client.connect();
  try {
    console.log('--- Testing query on error_groups table ---');
    const egRes = await client.query(`
      SELECT id, fingerprint, status, occurrence_count, first_seen_at, last_seen_at, 
             highest_severity, latest_severity, is_regression, regression_count, 
             last_regressed_at, latest_release, latest_sdk_version, latest_application_version, 
             last_error_message, last_error_name, last_status_code, last_trace_id, last_request_id, 
             merged_into, is_merged, version, created_at, updated_at
      FROM error_groups
      ORDER BY last_seen_at DESC
      LIMIT 5
    `);
    console.log(`Fetched ${egRes.rows.length} error_groups rows successfully!`);
    if (egRes.rows.length > 0) {
      console.log('Sample error_group row:', egRes.rows[0]);
    }

    console.log('\n--- Testing query on error_group_history table ---');
    const hRes = await client.query(`
      SELECT h.id, h.group_id, h.action, h.old_value, h.new_value, h.actor_id, h.metadata, h.created_at, e.last_error_name
      FROM error_group_history h
      LEFT JOIN error_groups e ON e.id = h.group_id
      ORDER BY h.created_at DESC
      LIMIT 5
    `);
    console.log(`Fetched ${hRes.rows.length} error_group_history rows successfully!`);
    if (hRes.rows.length > 0) {
      console.log('Sample error_group_history row:', hRes.rows[0]);
    }
  } catch (err) {
    console.error('Test query error:', err);
  } finally {
    await client.end();
  }
}
testQueries();
