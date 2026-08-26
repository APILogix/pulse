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
        t.table_type,
        pt.relkind::text as relkind,
        CASE pt.relkind 
          WHEN 'r' THEN 'table'
          WHEN 'p' THEN 'partitioned table'
          WHEN 'v' THEN 'view'
          WHEN 'f' THEN 'foreign table'
          ELSE pt.relkind::text
        END as table_classification
      FROM information_schema.columns c
      JOIN information_schema.tables t 
        ON c.table_schema = t.table_schema AND c.table_name = t.table_name
      JOIN pg_class pt ON pt.relname = c.table_name
      JOIN pg_namespace pn ON pn.oid = pt.relnamespace AND pn.nspname = c.table_schema
      WHERE c.column_name = 'public_id'
        AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY c.table_schema, c.table_name;
    `);
    report.tablesWithPublicId = tablesWithPubId.rows;
    console.log(`Found ${tablesWithPubId.rows.length} tables with public_id in Log DB`);

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
      WHERE proc.proname IN ('logdb_sync_typed_event_contract', 'trg_sync_error_groups_contract', 'sync_typed_event_contract', 'set_public_id')
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
      console.warn('Primary DB audit note:', e.message);
      report.primaryDbError = e.message;
    } finally {
      if (primaryClient) primaryClient.release();
    }

    console.log('=== 8. EMPIRICAL LIVE EXPERIMENTATION ON LOG DB ===');
    const experimentResults: any = {};

    const testOrgId = '00000000-0000-0000-0000-000000000001';
    const testProjId = '00000000-0000-0000-0000-000000000002';

    const targetTables = [
      'events_requests',
      'events_errors',
      'events_spans',
      'events_traces',
      'events_logs',
      'events_metrics',
      'events_messages',
      'events_replays',
      'events_profiles',
      'events_cron_checkins',
      'error_groups',
      'analytics_error_groups'
    ];

    for (const table of targetTables) {
      // Check if table exists in public schema
      const checkTbl = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
        [table]
      );
      if (checkTbl.rows.length === 0) continue;

      experimentResults[table] = {};

      // Find sequence associated with this table
      const seqPattern = table === 'error_groups' || table === 'analytics_error_groups'
        ? '%error_groups%'
        : `%${table.replace('events_', '')}%`;

      const seqRes = await client.query(`
        SELECT c.relname as seq_name
        FROM pg_class c 
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'S' AND c.relname LIKE $1 AND n.nspname = 'public'
      `, [seqPattern]);
      const seqName = seqRes.rows[0]?.seq_name;
      experimentResults[table].seqName = seqName;

      if (seqName) {
        const beforeSeq = await client.query(`SELECT last_value, is_called FROM ${seqName}`);
        experimentResults[table].initialSeq = beforeSeq.rows[0];
      }

      // Helper for testing
      const runTest = async (testName: string, sql: string, params: any[] = []) => {
        await client.query('BEGIN');
        try {
          let seqBefore = null;
          if (seqName) {
            seqBefore = (await client.query(`SELECT last_value, is_called FROM ${seqName}`)).rows[0];
          }

          const res = await client.query(sql, params);
          const returnedPubId = res.rows[0]?.public_id;

          let seqAfter = null;
          if (seqName) {
            seqAfter = (await client.query(`SELECT last_value, is_called FROM ${seqName}`)).rows[0];
          }

          return {
            success: true,
            returnedPublicId: returnedPubId,
            seqBefore,
            seqAfter,
            seqAdvanced: seqBefore && seqAfter ? Number(seqAfter.last_value) - Number(seqBefore.last_value) : null
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

      // Test 1: INSERT with public_id OMITTED
      let omitSql = '';
      if (table === 'error_groups' || table === 'analytics_error_groups') {
        omitSql = `
          INSERT INTO ${table} (
            organization_id, project_id, fingerprint, fingerprint_version, status,
            occurrence_count, first_seen_at, last_seen_at, latest_event_occurred_at,
            first_event_id, latest_event_id, highest_severity, latest_severity,
            latest_release, latest_sdk_version, latest_application_version,
            latest_environment, latest_service, last_error_message, last_error_name,
            last_status_code, last_trace_id, last_request_id, version
          ) VALUES (
            '${testOrgId}', '${testProjId}', 'fp_omit_${Date.now()}', 1, 'OPEN',
            1, NOW(), NOW(), NOW(),
            'evt_1', 'evt_1', 'ERROR', 'ERROR',
            '1.0.0', '1.0.0', '1.0.0',
            'test', 'test-svc', 'test msg', 'Error',
            500, 'trc_1', 'req_1', 1
          ) RETURNING public_id;
        `;
      } else {
        omitSql = `
          INSERT INTO ${table} (
            organization_id, project_id, api_key_name, environment, event_id, occurred_at
          ) VALUES (
            '${testOrgId}', '${testProjId}', 'test-key', 'test', 'evt_omit_${Date.now()}', NOW()
          ) RETURNING public_id;
        `;
      }
      experimentResults[table].test_omit_public_id = await runTest('omit', omitSql);

      // Test 2: INSERT with public_id = DEFAULT
      let defaultSql = '';
      if (table === 'error_groups' || table === 'analytics_error_groups') {
        defaultSql = `
          INSERT INTO ${table} (
            organization_id, project_id, fingerprint, fingerprint_version, status,
            occurrence_count, first_seen_at, last_seen_at, latest_event_occurred_at,
            first_event_id, latest_event_id, highest_severity, latest_severity,
            latest_release, latest_sdk_version, latest_application_version,
            latest_environment, latest_service, last_error_message, last_error_name,
            last_status_code, last_trace_id, last_request_id, version,
            public_id
          ) VALUES (
            '${testOrgId}', '${testProjId}', 'fp_def_${Date.now()}', 1, 'OPEN',
            1, NOW(), NOW(), NOW(),
            'evt_1', 'evt_1', 'ERROR', 'ERROR',
            '1.0.0', '1.0.0', '1.0.0',
            'test', 'test-svc', 'test msg', 'Error',
            500, 'trc_1', 'req_1', 1,
            DEFAULT
          ) RETURNING public_id;
        `;
      } else {
        defaultSql = `
          INSERT INTO ${table} (
            organization_id, project_id, api_key_name, environment, event_id, occurred_at, public_id
          ) VALUES (
            '${testOrgId}', '${testProjId}', 'test-key', 'test', 'evt_def_${Date.now()}', NOW(), DEFAULT
          ) RETURNING public_id;
        `;
      }
      experimentResults[table].test_explicit_default = await runTest('default', defaultSql);

      // Test 3: INSERT with public_id = NULL
      let nullSql = '';
      if (table === 'error_groups' || table === 'analytics_error_groups') {
        nullSql = `
          INSERT INTO ${table} (
            organization_id, project_id, fingerprint, fingerprint_version, status,
            occurrence_count, first_seen_at, last_seen_at, latest_event_occurred_at,
            first_event_id, latest_event_id, highest_severity, latest_severity,
            latest_release, latest_sdk_version, latest_application_version,
            latest_environment, latest_service, last_error_message, last_error_name,
            last_status_code, last_trace_id, last_request_id, version,
            public_id
          ) VALUES (
            '${testOrgId}', '${testProjId}', 'fp_null_${Date.now()}', 1, 'OPEN',
            1, NOW(), NOW(), NOW(),
            'evt_1', 'evt_1', 'ERROR', 'ERROR',
            '1.0.0', '1.0.0', '1.0.0',
            'test', 'test-svc', 'test msg', 'Error',
            500, 'trc_1', 'req_1', 1,
            NULL
          ) RETURNING public_id;
        `;
      } else {
        nullSql = `
          INSERT INTO ${table} (
            organization_id, project_id, api_key_name, environment, event_id, occurred_at, public_id
          ) VALUES (
            '${testOrgId}', '${testProjId}', 'test-key', 'test', 'evt_null_${Date.now()}', NOW(), NULL
          ) RETURNING public_id;
        `;
      }
      experimentResults[table].test_explicit_null = await runTest('null', nullSql);

      // Test 4: INSERT with public_id = '' (Empty string)
      let emptySql = '';
      if (table === 'error_groups' || table === 'analytics_error_groups') {
        emptySql = `
          INSERT INTO ${table} (
            organization_id, project_id, fingerprint, fingerprint_version, status,
            occurrence_count, first_seen_at, last_seen_at, latest_event_occurred_at,
            first_event_id, latest_event_id, highest_severity, latest_severity,
            latest_release, latest_sdk_version, latest_application_version,
            latest_environment, latest_service, last_error_message, last_error_name,
            last_status_code, last_trace_id, last_request_id, version,
            public_id
          ) VALUES (
            '${testOrgId}', '${testProjId}', 'fp_emp_${Date.now()}', 1, 'OPEN',
            1, NOW(), NOW(), NOW(),
            'evt_1', 'evt_1', 'ERROR', 'ERROR',
            '1.0.0', '1.0.0', '1.0.0',
            'test', 'test-svc', 'test msg', 'Error',
            500, 'trc_1', 'req_1', 1,
            ''
          ) RETURNING public_id;
        `;
      } else {
        emptySql = `
          INSERT INTO ${table} (
            organization_id, project_id, api_key_name, environment, event_id, occurred_at, public_id
          ) VALUES (
            '${testOrgId}', '${testProjId}', 'test-key', 'test', 'evt_emp_${Date.now()}', NOW(), ''
          ) RETURNING public_id;
        `;
      }
      experimentResults[table].test_empty_string = await runTest('empty', emptySql);

      // Test 5: INSERT with explicit custom public_id
      const customId = `CUSTOM-${Date.now().toString().slice(-6)}`;
      let customSql = '';
      if (table === 'error_groups' || table === 'analytics_error_groups') {
        customSql = `
          INSERT INTO ${table} (
            organization_id, project_id, fingerprint, fingerprint_version, status,
            occurrence_count, first_seen_at, last_seen_at, latest_event_occurred_at,
            first_event_id, latest_event_id, highest_severity, latest_severity,
            latest_release, latest_sdk_version, latest_application_version,
            latest_environment, latest_service, last_error_message, last_error_name,
            last_status_code, last_trace_id, last_request_id, version,
            public_id
          ) VALUES (
            '${testOrgId}', '${testProjId}', 'fp_cst_${Date.now()}', 1, 'OPEN',
            1, NOW(), NOW(), NOW(),
            'evt_1', 'evt_1', 'ERROR', 'ERROR',
            '1.0.0', '1.0.0', '1.0.0',
            'test', 'test-svc', 'test msg', 'Error',
            500, 'trc_1', 'req_1', 1,
            '${customId}'
          ) RETURNING public_id;
        `;
      } else {
        customSql = `
          INSERT INTO ${table} (
            organization_id, project_id, api_key_name, environment, event_id, occurred_at, public_id
          ) VALUES (
            '${testOrgId}', '${testProjId}', 'test-key', 'test', 'evt_cst_${Date.now()}', NOW(), '${customId}'
          ) RETURNING public_id;
        `;
      }
      const customRes = await runTest('custom', customSql);
      experimentResults[table].test_explicit_custom = {
        ...customRes,
        passedPublicId: customId,
        wasOverwritten: customRes.returnedPublicId !== customId
      };

      // Test 6: UPDATE behavior
      await client.query('BEGIN');
      try {
        let initialInsert = '';
        if (table === 'error_groups' || table === 'analytics_error_groups') {
          initialInsert = `
            INSERT INTO ${table} (
              organization_id, project_id, fingerprint, fingerprint_version, status,
              occurrence_count, first_seen_at, last_seen_at, latest_event_occurred_at,
              first_event_id, latest_event_id, highest_severity, latest_severity,
              latest_release, latest_sdk_version, latest_application_version,
              latest_environment, latest_service, last_error_message, last_error_name,
              last_status_code, last_trace_id, last_request_id, version
            ) VALUES (
              '${testOrgId}', '${testProjId}', 'fp_upd_${Date.now()}', 1, 'OPEN',
              1, NOW(), NOW(), NOW(),
              'evt_1', 'evt_1', 'ERROR', 'ERROR',
              '1.0.0', '1.0.0', '1.0.0',
              'test', 'test-svc', 'test msg', 'Error',
              500, 'trc_1', 'req_1', 1
            ) RETURNING id, public_id;
          `;
        } else {
          initialInsert = `
            INSERT INTO ${table} (
              organization_id, project_id, api_key_name, environment, event_id, occurred_at
            ) VALUES (
              '${testOrgId}', '${testProjId}', 'test-key', 'test', 'evt_upd_${Date.now()}', NOW()
            ) RETURNING id, public_id;
          `;
        }

        const initRes = await client.query(initialInsert);
        const initialPubId = initRes.rows[0]?.public_id;
        const rowId = initRes.rows[0]?.id;

        let seqBeforeUpdate = null;
        if (seqName) {
          seqBeforeUpdate = (await client.query(`SELECT last_value, is_called FROM ${seqName}`)).rows[0];
        }

        // Run UPDATE without modifying public_id
        if (table === 'error_groups' || table === 'analytics_error_groups') {
          await client.query(`UPDATE ${table} SET occurrence_count = occurrence_count + 1 WHERE id = $1`, [rowId]);
        } else {
          await client.query(`UPDATE ${table} SET environment = 'updated-env' WHERE id = $1`, [rowId]);
        }

        const afterUpdateRes = await client.query(`SELECT public_id FROM ${table} WHERE id = $1`, [rowId]);
        const updatedPubId = afterUpdateRes.rows[0]?.public_id;

        let seqAfterUpdate = null;
        if (seqName) {
          seqAfterUpdate = (await client.query(`SELECT last_value, is_called FROM ${seqName}`)).rows[0];
        }

        experimentResults[table].test_update_behavior = {
          success: true,
          initialPublicId: initialPubId,
          updatedPublicId: updatedPubId,
          changedOnUpdate: initialPubId !== updatedPubId,
          seqBeforeUpdate,
          seqAfterUpdate,
          seqAdvancedOnUpdate: seqBeforeUpdate && seqAfterUpdate ? Number(seqAfterUpdate.last_value) - Number(seqBeforeUpdate.last_value) : null
        };
      } catch (err: any) {
        experimentResults[table].test_update_behavior = {
          success: false,
          error: err.message
        };
      } finally {
        await client.query('ROLLBACK').catch(() => {});
      }
    }

    report.experiments = experimentResults;

    const outputPath = 'artifacts/public_id_audit_raw.json';
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`Forensic audit completed successfully! Output saved to ${outputPath}`);
    console.log(JSON.stringify(report, null, 2));

  } catch (err) {
    console.error('Fatal error during forensic audit:', err);
  } finally {
    client.release();
    await logDB.close().catch(() => undefined);
    await closeDatabase().catch(() => undefined);
  }
}

runForensicAudit();
