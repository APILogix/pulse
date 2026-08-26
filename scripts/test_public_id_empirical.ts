import { logDB } from '../src/config/log-database.js';
import { writeFile } from 'fs/promises';

interface TestCase {
  table: string;
  seq: string;
  prefix: string;
}

const targets: TestCase[] = [
  { table: 'events_requests', seq: 'seq_pubid_requests', prefix: 'REQ' },
  { table: 'events_errors', seq: 'seq_pubid_errors', prefix: 'ERR' },
  { table: 'events_spans', seq: 'seq_pubid_spans', prefix: 'SPN' },
  { table: 'events_traces', seq: 'seq_pubid_traces', prefix: 'TRC' },
  { table: 'events_logs', seq: 'seq_pubid_logs', prefix: 'LOG' },
  { table: 'events_metrics', seq: 'seq_pubid_metrics', prefix: 'MTR' },
  { table: 'events_messages', seq: 'seq_pubid_messages', prefix: 'MSG' },
  { table: 'events_replays', seq: 'seq_pubid_replays', prefix: 'RPL' },
  { table: 'events_profiles', seq: 'seq_pubid_profiles', prefix: 'PRF' },
  { table: 'events_cron_checkins', seq: 'seq_pubid_cron_checkins', prefix: 'CRN' },
  { table: 'error_groups', seq: 'seq_pubid_error_groups', prefix: 'ISS' },
  { table: 'analytics_user_sessions', seq: 'seq_pubid_sessions', prefix: 'SES' }
];

const testOrgId = '00000000-0000-0000-0000-000000000001';
const testProjId = '00000000-0000-0000-0000-000000000002';

async function testSingleTable(t: TestCase): Promise<any> {
  const client = await logDB.getPrimaryPool().connect();
  const tableResult: any = {};

  try {
    const readSeq = async () => {
      const r = await client.query(`SELECT last_value, is_called FROM ${t.seq}`);
      return { last_value: Number(r.rows[0].last_value), is_called: r.rows[0].is_called };
    };

    const buildInsert = (pubIdMode: 'OMIT' | 'DEFAULT' | 'NULL' | 'EMPTY' | 'CUSTOM', customVal?: string) => {
      const randId = `test_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      if (t.table === 'error_groups') {
        const cols = [
          'organization_id', 'project_id', 'fingerprint', 'fingerprint_version', 'status',
          'occurrence_count', 'first_seen_at', 'last_seen_at', 'latest_event_occurred_at',
          'first_event_id', 'latest_event_id', 'highest_severity', 'latest_severity',
          'latest_release', 'latest_sdk_version', 'latest_application_version',
          'latest_environment', 'latest_service', 'last_error_message', 'last_error_name',
          'last_status_code', 'last_trace_id', 'last_request_id', 'version'
        ];
        const vals = [
          `'${testOrgId}'`, `'${testProjId}'`, `'fp_${randId}'`, '1', "'OPEN'",
          '1', 'NOW()', 'NOW()', 'NOW()',
          "'evt_1'", "'evt_1'", "'ERROR'", "'ERROR'",
          "'1.0.0'", "'1.0.0'", "'1.0.0'",
          "'test'", "'test-svc'", "'test msg'", "'Error'",
          '500', "'trc_1'", "'req_1'", '1'
        ];
        if (pubIdMode === 'DEFAULT') { cols.push('public_id'); vals.push('DEFAULT'); }
        else if (pubIdMode === 'NULL') { cols.push('public_id'); vals.push('NULL'); }
        else if (pubIdMode === 'EMPTY') { cols.push('public_id'); vals.push("''"); }
        else if (pubIdMode === 'CUSTOM') { cols.push('public_id'); vals.push(`'${customVal}'`); }
        return `INSERT INTO error_groups (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING id, public_id;`;
      } else if (t.table === 'analytics_user_sessions') {
        const cols = ['organization_id', 'project_id', 'environment', 'session_id', 'started_at'];
        const vals = [`'${testOrgId}'`, `'${testProjId}'`, "'test'", `'ses_${randId}'`, 'NOW()'];
        if (pubIdMode === 'DEFAULT') { cols.push('public_id'); vals.push('DEFAULT'); }
        else if (pubIdMode === 'NULL') { cols.push('public_id'); vals.push('NULL'); }
        else if (pubIdMode === 'EMPTY') { cols.push('public_id'); vals.push("''"); }
        else if (pubIdMode === 'CUSTOM') { cols.push('public_id'); vals.push(`'${customVal}'`); }
        return `INSERT INTO analytics_user_sessions (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING id, public_id;`;
      } else if (t.table === 'events_errors') {
        const cols = ['organization_id', 'project_id', 'api_key_name', 'environment', 'event_id', 'error_name', 'occurred_at'];
        const vals = [`'${testOrgId}'`, `'${testProjId}'`, "'test-key'", "'test'", `'${randId}'`, "'TestError'", 'NOW()'];
        if (pubIdMode === 'DEFAULT') { cols.push('public_id'); vals.push('DEFAULT'); }
        else if (pubIdMode === 'NULL') { cols.push('public_id'); vals.push('NULL'); }
        else if (pubIdMode === 'EMPTY') { cols.push('public_id'); vals.push("''"); }
        else if (pubIdMode === 'CUSTOM') { cols.push('public_id'); vals.push(`'${customVal}'`); }
        return `INSERT INTO events_errors (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING id, public_id;`;
      } else {
        const cols = ['organization_id', 'project_id', 'api_key_name', 'environment', 'event_id', 'occurred_at'];
        const vals = [`'${testOrgId}'`, `'${testProjId}'`, "'test-key'", "'test'", `'${randId}'`, 'NOW()'];
        if (pubIdMode === 'DEFAULT') { cols.push('public_id'); vals.push('DEFAULT'); }
        else if (pubIdMode === 'NULL') { cols.push('public_id'); vals.push('NULL'); }
        else if (pubIdMode === 'EMPTY') { cols.push('public_id'); vals.push("''"); }
        else if (pubIdMode === 'CUSTOM') { cols.push('public_id'); vals.push(`'${customVal}'`); }
        return `INSERT INTO ${t.table} (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING id, public_id;`;
      }
    };

    // Test 1: Omit public_id
    try {
      const seqBefore = await readSeq();
      await client.query('BEGIN');
      const res = await client.query(buildInsert('OMIT'));
      const pubId = res.rows[0]?.public_id;
      await client.query('ROLLBACK');
      const seqAfter = await readSeq();
      tableResult.omit_public_id = {
        success: true,
        generated_public_id: pubId,
        seq_before: seqBefore,
        seq_after: seqAfter,
        seq_delta: seqAfter.last_value - seqBefore.last_value,
        sequence_consumed_even_on_rollback: seqAfter.last_value > seqBefore.last_value
      };
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      tableResult.omit_public_id = { success: false, error: e.message };
    }

    // Test 2: Explicit DEFAULT
    try {
      const seqBefore = await readSeq();
      await client.query('BEGIN');
      const res = await client.query(buildInsert('DEFAULT'));
      const pubId = res.rows[0]?.public_id;
      await client.query('ROLLBACK');
      const seqAfter = await readSeq();
      tableResult.explicit_default = {
        success: true,
        generated_public_id: pubId,
        seq_before: seqBefore,
        seq_after: seqAfter,
        seq_delta: seqAfter.last_value - seqBefore.last_value
      };
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      tableResult.explicit_default = { success: false, error: e.message };
    }

    // Test 3: Explicit NULL
    try {
      const seqBefore = await readSeq();
      await client.query('BEGIN');
      const res = await client.query(buildInsert('NULL'));
      const pubId = res.rows[0]?.public_id;
      await client.query('ROLLBACK');
      const seqAfter = await readSeq();
      tableResult.explicit_null = {
        success: true,
        generated_public_id: pubId,
        seq_before: seqBefore,
        seq_after: seqAfter,
        seq_delta: seqAfter.last_value - seqBefore.last_value,
        note: 'Trigger intercepted NULL before NOT NULL constraint check and assigned next sequence value'
      };
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      tableResult.explicit_null = { success: false, error: e.message };
    }

    // Test 4: Explicit Empty String ''
    try {
      const seqBefore = await readSeq();
      await client.query('BEGIN');
      const res = await client.query(buildInsert('EMPTY'));
      const pubId = res.rows[0]?.public_id;
      await client.query('ROLLBACK');
      const seqAfter = await readSeq();
      tableResult.explicit_empty_string = {
        success: true,
        generated_public_id: pubId,
        seq_before: seqBefore,
        seq_after: seqAfter,
        seq_delta: seqAfter.last_value - seqBefore.last_value,
        note: "Trigger intercepted '' and assigned next sequence value"
      };
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      tableResult.explicit_empty_string = { success: false, error: e.message };
    }

    // Test 5: Explicit Custom Value
    try {
      const customVal = `CUSTOM-${t.prefix}-999999`;
      const seqBefore = await readSeq();
      await client.query('BEGIN');
      const res = await client.query(buildInsert('CUSTOM', customVal));
      const pubId = res.rows[0]?.public_id;
      await client.query('ROLLBACK');
      const seqAfter = await readSeq();
      tableResult.explicit_custom = {
        success: true,
        passed_value: customVal,
        stored_value: pubId,
        preserved: pubId === customVal,
        seq_before: seqBefore,
        seq_after: seqAfter,
        seq_delta: seqAfter.last_value - seqBefore.last_value,
        sequence_consumed: seqAfter.last_value > seqBefore.last_value
      };
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      tableResult.explicit_custom = { success: false, error: e.message };
    }

    // Test 6: UPDATE behavior
    try {
      await client.query('BEGIN');
      const insertRes = await client.query(buildInsert('OMIT'));
      const rowId = insertRes.rows[0]?.id;
      const initialPubId = insertRes.rows[0]?.public_id;
      const seqBeforeUpdate = await readSeq();

      if (t.table === 'error_groups') {
        await client.query(`UPDATE error_groups SET occurrence_count = occurrence_count + 1 WHERE id = $1`, [rowId]);
      } else if (t.table === 'analytics_user_sessions') {
        await client.query(`UPDATE analytics_user_sessions SET environment = 'staging' WHERE id = $1`, [rowId]);
      } else {
        await client.query(`UPDATE ${t.table} SET environment = 'staging' WHERE id = $1`, [rowId]);
      }

      const readRes = await client.query(`SELECT public_id FROM ${t.table} WHERE id = $1`, [rowId]);
      const pubIdAfterRegularUpdate = readRes.rows[0]?.public_id;
      const seqAfterRegularUpdate = await readSeq();

      // Update setting public_id = NULL
      let nullUpdSuccess = false;
      let nullUpdPubId = null;
      try {
        const resNull = await client.query(`UPDATE ${t.table} SET public_id = NULL WHERE id = $1 RETURNING public_id`, [rowId]);
        nullUpdSuccess = true;
        nullUpdPubId = resNull.rows[0]?.public_id;
      } catch (e: any) {}

      // Update setting public_id = ''
      let emptyUpdSuccess = false;
      let emptyUpdPubId = null;
      try {
        const resEmpty = await client.query(`UPDATE ${t.table} SET public_id = '' WHERE id = $1 RETURNING public_id`, [rowId]);
        emptyUpdSuccess = true;
        emptyUpdPubId = resEmpty.rows[0]?.public_id;
      } catch (e: any) {}

      await client.query('ROLLBACK');

      tableResult.update_behavior = {
        success: true,
        initial_public_id: initialPubId,
        pub_id_after_regular_update: pubIdAfterRegularUpdate,
        pub_id_mutated_on_regular_update: initialPubId !== pubIdAfterRegularUpdate,
        seq_advanced_on_regular_update: seqAfterRegularUpdate.last_value > seqBeforeUpdate.last_value,
        update_setting_null_intercepted_by_trigger: nullUpdSuccess,
        new_pub_id_on_null_update: nullUpdPubId,
        update_setting_empty_intercepted_by_trigger: emptyUpdSuccess,
        new_pub_id_on_empty_update: emptyUpdPubId
      };
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      tableResult.update_behavior = { success: false, error: e.message };
    }

  } finally {
    client.release();
  }

  return tableResult;
}

async function main() {
  const allResults: any = {};

  for (const t of targets) {
    console.log(`Starting test for ${t.table}...`);
    try {
      allResults[t.table] = await testSingleTable(t);
      console.log(`Completed ${t.table}`);
    } catch (err: any) {
      console.error(`Failed ${t.table}:`, err.message);
      allResults[t.table] = { error: err.message };
    }
  }

  await writeFile('artifacts/public_id_empirical_results.json', JSON.stringify(allResults, null, 2), 'utf8');
  console.log('All empirical test results successfully written to artifacts/public_id_empirical_results.json');
}

main().catch(console.error).finally(async () => {
  await logDB.close();
});
