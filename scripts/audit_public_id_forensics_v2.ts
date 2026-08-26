import { logDB } from '../src/config/log-database.js';
import { pool as primaryPool, closeDatabase } from '../src/config/database.js';
import { writeFile } from 'fs/promises';

async function runForensicAudit() {
  const client = await logDB.getPrimaryPool().connect();
  const report: any = {};

  try {
    console.log('=== 1. DISCOVER ALL TABLES WITH public_id IN LOG DB ===');
    const tablesWithPubId = await client.query(`
      SELECT 
        c.table_schema,
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        pt.relkind::text as relkind,
        CASE pt.relkind 
          WHEN 'r' THEN 'regular table'
          WHEN 'p' THEN 'partitioned table'
          WHEN 'v' THEN 'view'
          WHEN 'f' THEN 'foreign table'
          ELSE pt.relkind::text
        END as table_classification
      FROM information_schema.columns c
      JOIN pg_class pt ON pt.relname = c.table_name
      JOIN pg_namespace pn ON pn.oid = pt.relnamespace AND pn.nspname = c.table_schema
      WHERE c.column_name = 'public_id'
        AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY c.table_schema, c.table_name;
    `);
    report.tablesWithPublicId = tablesWithPubId.rows;
    console.log(`Found ${tablesWithPubId.rows.length} tables/partitions with public_id in Log DB`);

    console.log('=== 2. DETAILED COLUMN DEFAULTS VIA PG_CATALOG ===');
    const colDefaults = await client.query(`
      SELECT 
        ns.nspname AS schema_name,
        tbl.relname AS table_name,
        attr.attname AS column_name,
        format_type(attr.atttypid, attr.atttypmod) AS column_type,
        attr.attnotnull AS is_not_null,
        pg_get_expr(def.adbin, def.adrelid) AS default_expression
      FROM pg_attribute attr
      JOIN pg_class tbl ON tbl.oid = attr.attrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      LEFT JOIN pg_attrdef def ON def.adrelid = attr.attrelid AND def.adnum = attr.attnum
      WHERE attr.attname = 'public_id'
        AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY ns.nspname, tbl.relname;
    `);
    report.columnDefaults = colDefaults.rows;

    console.log('=== 3. ALL SEQUENCES RELATED TO PUBLIC ID ===');
    const sequences = await client.query(`
      SELECT 
        schemaname,
        sequencename,
        sequenceowner,
        data_type,
        start_value,
        min_value,
        max_value,
        increment_by,
        cycle,
        last_value
      FROM pg_sequences
      WHERE sequencename LIKE '%pubid%' OR sequencename LIKE '%public_id%'
      ORDER BY sequencename;
    `);
    report.sequences = sequences.rows;

    console.log('=== 4. TRIGGERS ON TABLES WITH public_id ===');
    const triggers = await client.query(`
      SELECT 
        ns.nspname AS schema_name,
        tbl.relname AS table_name,
        trg.tgname AS trigger_name,
        CASE trg.tgenabled
          WHEN 'O' THEN 'enabled'
          WHEN 'D' THEN 'disabled'
          WHEN 'R' THEN 'replica'
          WHEN 'A' THEN 'always'
        END AS trigger_status,
        CASE (trg.tgtype::int & 66)
          WHEN 2 THEN 'BEFORE'
          WHEN 64 THEN 'INSTEAD OF'
          ELSE 'AFTER'
        END AS trigger_timing,
        ARRAY_TO_STRING(ARRAY[
          CASE WHEN (trg.tgtype::int & 4) <> 0 THEN 'INSERT' END,
          CASE WHEN (trg.tgtype::int & 8) <> 0 THEN 'DELETE' END,
          CASE WHEN (trg.tgtype::int & 16) <> 0 THEN 'UPDATE' END
        ], ' OR ') AS trigger_events,
        CASE WHEN (trg.tgtype::int & 1) <> 0 THEN 'ROW' ELSE 'STATEMENT' END AS trigger_level,
        proc.proname AS function_name,
        pg_get_triggerdef(trg.oid) AS trigger_definition
      FROM pg_trigger trg
      JOIN pg_class tbl ON tbl.oid = trg.tgrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      JOIN pg_proc proc ON proc.oid = trg.tgfoid
      WHERE NOT trg.tgisinternal
        AND tbl.relname IN (
          SELECT c.table_name FROM information_schema.columns c
          WHERE c.column_name = 'public_id' AND c.table_schema = ns.nspname
        )
      ORDER BY tbl.relname, trg.tgname;
    `);
    report.triggers = triggers.rows;

    console.log('=== 5. TRIGGER FUNCTIONS SOURCE CODE ===');
    const triggerFunctions = await client.query(`
      SELECT 
        ns.nspname AS schema_name,
        proc.proname AS function_name,
        pg_get_functiondef(proc.oid) AS function_definition
      FROM pg_proc proc
      JOIN pg_namespace ns ON ns.oid = proc.pronamespace
      WHERE proc.proname IN (
        'logdb_sync_typed_event_contract',
        'logdb_sync_error_groups_contract',
        'logdb_sync_user_sessions_contract',
        'trg_sync_error_groups_contract',
        'sync_typed_event_contract',
        'set_public_id'
      )
      OR proc.proname LIKE '%pubid%'
      OR proc.proname LIKE '%typed_event_contract%'
      ORDER BY proc.proname;
    `);
    report.triggerFunctions = triggerFunctions.rows;

    console.log('=== 6. INDEXES ON public_id ===');
    const indexes = await client.query(`
      SELECT 
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE (indexdef LIKE '%public_id%' OR indexname LIKE '%pubid%')
        AND schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY tablename, indexname;
    `);
    report.indexes = indexes.rows;

    console.log('=== 7. PRIMARY DB AUDIT FOR public_id ===');
    let primaryClient;
    try {
      primaryClient = await primaryPool.connect();
      const primaryTables = await primaryClient.query(`
        SELECT 
          c.table_schema,
          c.table_name,
          c.column_name,
          c.data_type,
          c.is_nullable,
          c.column_default
        FROM information_schema.columns c
        WHERE c.column_name = 'public_id'
          AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY c.table_schema, c.table_name;
      `);
      report.primaryTablesWithPublicId = primaryTables.rows;

      const primarySequences = await primaryClient.query(`
        SELECT 
          schemaname,
          sequencename,
          start_value,
          last_value
        FROM pg_sequences
        WHERE sequencename LIKE '%pubid%' OR sequencename LIKE '%public_id%'
        ORDER BY sequencename;
      `);
      report.primarySequences = primarySequences.rows;

      const primaryTriggers = await primaryClient.query(`
        SELECT 
          ns.nspname AS schema_name,
          tbl.relname AS table_name,
          trg.tgname AS trigger_name,
          proc.proname AS function_name,
          pg_get_triggerdef(trg.oid) AS trigger_definition
        FROM pg_trigger trg
        JOIN pg_class tbl ON tbl.oid = trg.tgrelid
        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
        JOIN pg_proc proc ON proc.oid = trg.tgfoid
        WHERE NOT trg.tgisinternal
          AND tbl.relname IN (
            SELECT c.table_name FROM information_schema.columns c
            WHERE c.column_name = 'public_id' AND c.table_schema = ns.nspname
          )
        ORDER BY tbl.relname, trg.tgname;
      `);
      report.primaryTriggers = primaryTriggers.rows;
    } catch (e: any) {
      report.primaryDbNote = e.message;
    } finally {
      if (primaryClient) primaryClient.release();
    }

    // Save catalog data immediately
    await writeFile('artifacts/public_id_catalog_audit.json', JSON.stringify(report, null, 2), 'utf8');
    console.log('Catalog audit written to artifacts/public_id_catalog_audit.json');

    console.log('=== 8. LIVE EMPIRICAL TESTING ON CANONICAL TABLES ===');
    const canonicalTables = [
      { name: 'events_requests', seq: 'seq_pubid_requests', prefix: 'REQ' },
      { name: 'events_errors', seq: 'seq_pubid_errors', prefix: 'ERR' },
      { name: 'events_traces', seq: 'seq_pubid_traces', prefix: 'TRC' },
      { name: 'events_spans', seq: 'seq_pubid_spans', prefix: 'SPN' },
      { name: 'events_logs', seq: 'seq_pubid_logs', prefix: 'LOG' },
      { name: 'events_metrics', seq: 'seq_pubid_metrics', prefix: 'MTR' },
      { name: 'events_messages', seq: 'seq_pubid_messages', prefix: 'MSG' },
      { name: 'events_replays', seq: 'seq_pubid_replays', prefix: 'RPL' },
      { name: 'events_profiles', seq: 'seq_pubid_profiles', prefix: 'PRF' },
      { name: 'events_cron_checkins', seq: 'seq_pubid_cron_checkins', prefix: 'CRN' },
      { name: 'error_groups', seq: 'seq_pubid_error_groups', prefix: 'ISS' },
      { name: 'analytics_error_groups', seq: 'seq_pubid_error_groups', prefix: 'ISS' },
      { name: 'analytics_user_sessions', seq: 'seq_pubid_sessions', prefix: 'SES' }
    ];

    const empiricalResults: any = {};
    const testOrgId = '00000000-0000-0000-0000-000000000001';
    const testProjId = '00000000-0000-0000-0000-000000000002';

    const getSeqVal = async (seqName: string) => {
      const res = await client.query(`SELECT last_value FROM pg_sequences WHERE sequencename = $1`, [seqName]);
      return res.rows[0]?.last_value ? Number(res.rows[0].last_value) : null;
    };

    for (const item of canonicalTables) {
      const tbl = item.name;
      const seq = item.seq;

      const exists = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
        [tbl]
      );
      if (exists.rows.length === 0) continue;

      empiricalResults[tbl] = {};

      const execTest = async (testDesc: string, insertClause: string, valuesClause: string, retCol = 'public_id') => {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        await client.query("SET LOCAL statement_timeout = '3000ms'");
        try {
          const valBefore = await getSeqVal(seq);
          const sql = `INSERT INTO ${tbl} ${insertClause} VALUES ${valuesClause} RETURNING ${retCol}`;
          const res = await client.query(sql);
          const valAfter = await getSeqVal(seq);
          return {
            success: true,
            returnedPublicId: res.rows[0]?.[retCol],
            seqBefore: valBefore,
            seqAfter: valAfter,
            seqDelta: valBefore !== null && valAfter !== null ? valAfter - valBefore : null
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.message,
            code: err.code
          };
        } finally {
          await client.query('ROLLBACK').catch(() => {});
        }
      };

      // Helper to generate values
      const getBaseInsert = (publicIdVal?: string | null | 'DEFAULT' | 'OMIT') => {
        const nowMs = Date.now();
        const randEventId = `evt_test_${nowMs}_${Math.floor(Math.random() * 10000)}`;

        if (tbl === 'error_groups' || tbl === 'analytics_error_groups') {
          const cols = [
            'organization_id', 'project_id', 'fingerprint', 'fingerprint_version', 'status',
            'occurrence_count', 'first_seen_at', 'last_seen_at', 'latest_event_occurred_at',
            'first_event_id', 'latest_event_id', 'highest_severity', 'latest_severity',
            'latest_release', 'latest_sdk_version', 'latest_application_version',
            'latest_environment', 'latest_service', 'last_error_message', 'last_error_name',
            'last_status_code', 'last_trace_id', 'last_request_id', 'version'
          ];
          const vals = [
            `'${testOrgId}'`, `'${testProjId}'`, `'fp_${randEventId}'`, '1', "'OPEN'",
            '1', 'NOW()', 'NOW()', 'NOW()',
            "'evt_1'", "'evt_1'", "'ERROR'", "'ERROR'",
            "'1.0.0'", "'1.0.0'", "'1.0.0'",
            "'test'", "'test-svc'", "'test msg'", "'Error'",
            '500', "'trc_1'", "'req_1'", '1'
          ];
          if (publicIdVal !== 'OMIT') {
            cols.push('public_id');
            if (publicIdVal === 'DEFAULT') vals.push('DEFAULT');
            else if (publicIdVal === null) vals.push('NULL');
            else vals.push(`'${publicIdVal}'`);
          }
          return { insertClause: `(${cols.join(', ')})`, valuesClause: `(${vals.join(', ')})` };
        } else if (tbl === 'analytics_user_sessions') {
          const cols = ['organization_id', 'project_id', 'session_id', 'first_seen_at', 'last_seen_at'];
          const vals = [`'${testOrgId}'`, `'${testProjId}'`, `'ses_${randEventId}'`, 'NOW()', 'NOW()'];
          if (publicIdVal !== 'OMIT') {
            cols.push('public_id');
            if (publicIdVal === 'DEFAULT') vals.push('DEFAULT');
            else if (publicIdVal === null) vals.push('NULL');
            else vals.push(`'${publicIdVal}'`);
          }
          return { insertClause: `(${cols.join(', ')})`, valuesClause: `(${vals.join(', ')})` };
        } else {
          // Standard typed event tables
          const cols = ['organization_id', 'project_id', 'api_key_name', 'environment', 'event_id', 'occurred_at'];
          const vals = [`'${testOrgId}'`, `'${testProjId}'`, "'test-key'", "'test'", `'${randEventId}'`, 'NOW()'];
          if (publicIdVal !== 'OMIT') {
            cols.push('public_id');
            if (publicIdVal === 'DEFAULT') vals.push('DEFAULT');
            else if (publicIdVal === null) vals.push('NULL');
            else vals.push(`'${publicIdVal}'`);
          }
          return { insertClause: `(${cols.join(', ')})`, valuesClause: `(${vals.join(', ')})` };
        }
      };

      // 1. OMIT public_id
      const omitPayload = getBaseInsert('OMIT');
      empiricalResults[tbl].test_1_omit_public_id = await execTest('omit', omitPayload.insertClause, omitPayload.valuesClause);

      // 2. Explicit DEFAULT
      const defaultPayload = getBaseInsert('DEFAULT');
      empiricalResults[tbl].test_2_explicit_default = await execTest('default', defaultPayload.insertClause, defaultPayload.valuesClause);

      // 3. Explicit NULL
      const nullPayload = getBaseInsert(null);
      empiricalResults[tbl].test_3_explicit_null = await execTest('null', nullPayload.insertClause, nullPayload.valuesClause);

      // 4. Explicit Empty String ''
      const emptyPayload = getBaseInsert('');
      empiricalResults[tbl].test_4_explicit_empty_string = await execTest('empty', emptyPayload.insertClause, emptyPayload.valuesClause);

      // 5. Explicit Custom public_id
      const customId = `CUSTOM-${item.prefix}-9999`;
      const customPayload = getBaseInsert(customId);
      const customRes = await execTest('custom', customPayload.insertClause, customPayload.valuesClause);
      empiricalResults[tbl].test_5_explicit_custom_id = {
        ...customRes,
        passedValue: customId,
        preserved: customRes.returnedPublicId === customId
      };

      // 6. UPDATE Behavior test
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '2000ms'");
      await client.query("SET LOCAL statement_timeout = '3000ms'");
      try {
        const initPayload = getBaseInsert('OMIT');
        const initRes = await client.query(`INSERT INTO ${tbl} ${initPayload.insertClause} VALUES ${initPayload.valuesClause} RETURNING id, public_id`);
        const rowId = initRes.rows[0]?.id;
        const initialPubId = initRes.rows[0]?.public_id;

        const valBeforeUpd = await getSeqVal(seq);

        // Update non-public_id column
        if (tbl === 'error_groups' || tbl === 'analytics_error_groups') {
          await client.query(`UPDATE ${tbl} SET occurrence_count = occurrence_count + 1 WHERE id = $1`, [rowId]);
        } else if (tbl === 'analytics_user_sessions') {
          await client.query(`UPDATE ${tbl} SET last_seen_at = NOW() WHERE id = $1`, [rowId]);
        } else {
          await client.query(`UPDATE ${tbl} SET environment = 'test_updated' WHERE id = $1`, [rowId]);
        }

        const afterUpdRes = await client.query(`SELECT public_id FROM ${tbl} WHERE id = $1`, [rowId]);
        const valAfterUpd = await getSeqVal(seq);

        // Update setting public_id = NULL
        let nullUpdSuccess = false;
        let nullUpdPubId = null;
        let nullUpdError = null;
        try {
          const resNullUpd = await client.query(`UPDATE ${tbl} SET public_id = NULL WHERE id = $1 RETURNING public_id`, [rowId]);
          nullUpdSuccess = true;
          nullUpdPubId = resNullUpd.rows[0]?.public_id;
        } catch (e: any) {
          nullUpdError = e.message;
        }

        // Update setting public_id = ''
        let emptyUpdSuccess = false;
        let emptyUpdPubId = null;
        let emptyUpdError = null;
        try {
          const resEmptyUpd = await client.query(`UPDATE ${tbl} SET public_id = '' WHERE id = $1 RETURNING public_id`, [rowId]);
          emptyUpdSuccess = true;
          emptyUpdPubId = resEmptyUpd.rows[0]?.public_id;
        } catch (e: any) {
          emptyUpdError = e.message;
        }

        empiricalResults[tbl].test_6_update_behavior = {
          success: true,
          initialPublicId: initialPubId,
          publicIdAfterRegularUpdate: afterUpdRes.rows[0]?.public_id,
          publicIdChangedOnRegularUpdate: initialPubId !== afterUpdRes.rows[0]?.public_id,
          seqBeforeUpdate: valBeforeUpd,
          seqAfterUpdate: valAfterUpd,
          seqDeltaOnRegularUpdate: valBeforeUpd !== null && valAfterUpd !== null ? valAfterUpd - valBeforeUpd : null,
          updateWithNull: { success: nullUpdSuccess, resultingPublicId: nullUpdPubId, error: nullUpdError },
          updateWithEmpty: { success: emptyUpdSuccess, resultingPublicId: emptyUpdPubId, error: emptyUpdError }
        };
      } catch (err: any) {
        empiricalResults[tbl].test_6_update_behavior = {
          success: false,
          error: err.message
        };
      } finally {
        await client.query('ROLLBACK').catch(() => {});
      }
    }

    report.empiricalLiveTests = empiricalResults;
    await writeFile('artifacts/public_id_audit_complete.json', JSON.stringify(report, null, 2), 'utf8');
    console.log('Complete forensic report successfully written to artifacts/public_id_audit_complete.json');

  } catch (err) {
    console.error('Fatal error during forensic audit:', err);
  } finally {
    client.release();
    await logDB.close().catch(() => undefined);
    await closeDatabase().catch(() => undefined);
  }
}

runForensicAudit();
