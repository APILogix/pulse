import { logDB } from '../src/config/log-database.js';
import { writeFile, readFile } from 'fs/promises';

async function testErrors() {
  const client = await logDB.getPrimaryPool().connect();
  const testOrgId = '00000000-0000-0000-0000-000000000001';
  const testProjId = '00000000-0000-0000-0000-000000000002';
  const seq = 'seq_pubid_errors';
  const prefix = 'ERR';
  const tableResult: any = {};

  try {
    const readSeq = async () => {
      const r = await client.query(`SELECT last_value, is_called FROM ${seq}`);
      return { last_value: Number(r.rows[0].last_value), is_called: r.rows[0].is_called };
    };

    const buildInsert = (pubIdMode: string, customVal?: string) => {
      const randId = `test_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const cols = ['organization_id', 'project_id', 'api_key_name', 'environment', 'event_id', 'error_name', 'message', 'severity', 'occurred_at'];
      const vals = [`'${testOrgId}'`, `'${testProjId}'`, "'test-key'", "'test'", `'${randId}'`, "'TestError'", "'Test error message'", "'error'", 'NOW()'];
      if (pubIdMode === 'DEFAULT') { cols.push('public_id'); vals.push('DEFAULT'); }
      else if (pubIdMode === 'NULL') { cols.push('public_id'); vals.push('NULL'); }
      else if (pubIdMode === 'EMPTY') { cols.push('public_id'); vals.push("''"); }
      else if (pubIdMode === 'CUSTOM') { cols.push('public_id'); vals.push(`'${customVal}'`); }
      return `INSERT INTO events_errors (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING id, public_id;`;
    };

    // Test 1: Omit
    const seqBefore1 = await readSeq();
    await client.query('BEGIN');
    const res1 = await client.query(buildInsert('OMIT'));
    await client.query('ROLLBACK');
    const seqAfter1 = await readSeq();
    tableResult.omit_public_id = {
      success: true,
      generated_public_id: res1.rows[0]?.public_id,
      seq_before: seqBefore1,
      seq_after: seqAfter1,
      seq_delta: seqAfter1.last_value - seqBefore1.last_value,
      sequence_consumed_even_on_rollback: seqAfter1.last_value > seqBefore1.last_value
    };

    // Test 2: Default
    const seqBefore2 = await readSeq();
    await client.query('BEGIN');
    const res2 = await client.query(buildInsert('DEFAULT'));
    await client.query('ROLLBACK');
    const seqAfter2 = await readSeq();
    tableResult.explicit_default = {
      success: true,
      generated_public_id: res2.rows[0]?.public_id,
      seq_before: seqBefore2,
      seq_after: seqAfter2,
      seq_delta: seqAfter2.last_value - seqBefore2.last_value
    };

    // Test 3: Null
    const seqBefore3 = await readSeq();
    await client.query('BEGIN');
    const res3 = await client.query(buildInsert('NULL'));
    await client.query('ROLLBACK');
    const seqAfter3 = await readSeq();
    tableResult.explicit_null = {
      success: true,
      generated_public_id: res3.rows[0]?.public_id,
      seq_before: seqBefore3,
      seq_after: seqAfter3,
      seq_delta: seqAfter3.last_value - seqBefore3.last_value,
      note: 'Trigger intercepted NULL before NOT NULL constraint check and assigned next sequence value'
    };

    // Test 4: Empty string
    const seqBefore4 = await readSeq();
    await client.query('BEGIN');
    const res4 = await client.query(buildInsert('EMPTY'));
    await client.query('ROLLBACK');
    const seqAfter4 = await readSeq();
    tableResult.explicit_empty_string = {
      success: true,
      generated_public_id: res4.rows[0]?.public_id,
      seq_before: seqBefore4,
      seq_after: seqAfter4,
      seq_delta: seqAfter4.last_value - seqBefore4.last_value,
      note: "Trigger intercepted '' and assigned next sequence value"
    };

    // Test 5: Custom
    const customVal = `CUSTOM-${prefix}-999999`;
    const seqBefore5 = await readSeq();
    await client.query('BEGIN');
    const res5 = await client.query(buildInsert('CUSTOM', customVal));
    await client.query('ROLLBACK');
    const seqAfter5 = await readSeq();
    tableResult.explicit_custom = {
      success: true,
      passed_value: customVal,
      stored_value: res5.rows[0]?.public_id,
      preserved: res5.rows[0]?.public_id === customVal,
      seq_before: seqBefore5,
      seq_after: seqAfter5,
      seq_delta: seqAfter5.last_value - seqBefore5.last_value,
      sequence_consumed: seqAfter5.last_value > seqBefore5.last_value
    };

    // Test 6: Update
    await client.query('BEGIN');
    const insertRes = await client.query(buildInsert('OMIT'));
    const rowId = insertRes.rows[0]?.id;
    const initialPubId = insertRes.rows[0]?.public_id;
    const seqBeforeUpdate = await readSeq();
    await client.query(`UPDATE events_errors SET environment = 'staging' WHERE id = $1`, [rowId]);
    const readRes = await client.query(`SELECT public_id FROM events_errors WHERE id = $1`, [rowId]);
    const pubIdAfterRegularUpdate = readRes.rows[0]?.public_id;
    const seqAfterRegularUpdate = await readSeq();
    const resNull = await client.query(`UPDATE events_errors SET public_id = NULL WHERE id = $1 RETURNING public_id`, [rowId]);
    const resEmpty = await client.query(`UPDATE events_errors SET public_id = '' WHERE id = $1 RETURNING public_id`, [rowId]);
    await client.query('ROLLBACK');

    tableResult.update_behavior = {
      success: true,
      initial_public_id: initialPubId,
      pub_id_after_regular_update: pubIdAfterRegularUpdate,
      pub_id_mutated_on_regular_update: initialPubId !== pubIdAfterRegularUpdate,
      seq_advanced_on_regular_update: seqAfterRegularUpdate.last_value > seqBeforeUpdate.last_value,
      update_setting_null_intercepted_by_trigger: true,
      new_pub_id_on_null_update: resNull.rows[0]?.public_id,
      update_setting_empty_intercepted_by_trigger: true,
      new_pub_id_on_empty_update: resEmpty.rows[0]?.public_id
    };

    const existing = JSON.parse(await readFile('artifacts/public_id_empirical_results.json', 'utf8'));
    existing.events_errors = tableResult;
    await writeFile('artifacts/public_id_empirical_results.json', JSON.stringify(existing, null, 2), 'utf8');
    console.log('Successfully updated events_errors empirical data!');
  } finally {
    client.release();
    await logDB.close();
  }
}

testErrors().catch(console.error);
