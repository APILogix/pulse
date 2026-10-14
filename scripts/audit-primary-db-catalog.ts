import { config } from 'dotenv';
config();
import { pool } from '../src/config/database.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const client = await pool.connect();
  try {
    console.log('=== 1. Live Primary Database Catalog Inspection ===');

    // 1. All tables in public schema
    const tablesRes = await client.query(`
      SELECT 
        c.relname AS table_name,
        c.reltuples::bigint AS estimated_rows,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
        pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
        pg_size_pretty(pg_indexes_size(c.oid)) AS indexes_size
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname;
    `);

    console.log(`Found ${tablesRes.rows.length} base tables in public schema.`);

    // 2. All indexes with column definitions
    const indexesRes = await client.query(`
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        ix.indisunique AS is_unique,
        ix.indisprimary AS is_primary,
        pg_get_indexdef(ix.indexrelid) AS index_def,
        ARRAY(
          SELECT pg_get_indexdef(ix.indexrelid, k + 1, true)
          FROM generate_subscripts(ix.indkey, 1) as k
          ORDER BY k
        ) AS column_names,
        pg_get_expr(ix.indpred, ix.indrelid) AS partial_predicate
      FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relkind = 'r'
      ORDER BY t.relname, i.relname;
    `);

    console.log(`Found ${indexesRes.rows.length} indexes in public schema.`);

    // 3. Foreign key constraints
    const fkRes = await client.query(`
      SELECT
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.update_rule,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      ORDER BY tc.table_name, kcu.column_name;
    `);

    console.log(`Found ${fkRes.rows.length} foreign key constraints.`);

    // 4. Duplicate / Redundant Index Detection
    const duplicateIndexes: any[] = [];
    const redundantIndexes: any[] = [];

    // Group indexes by table
    const tableIndexesMap = new Map<string, any[]>();
    for (const idx of indexesRes.rows) {
      if (!tableIndexesMap.has(idx.table_name)) {
        tableIndexesMap.set(idx.table_name, []);
      }
      tableIndexesMap.get(idx.table_name)!.push(idx);
    }

    for (const [tableName, idxList] of tableIndexesMap.entries()) {
      for (let a = 0; a < idxList.length; a++) {
        for (let b = a + 1; b < idxList.length; b++) {
          const idxA = idxList[a];
          const idxB = idxList[b];

          // Check identical index definitions (ignoring name)
          const colsA = idxA.column_names.join(', ');
          const colsB = idxB.column_names.join(', ');
          const predA = idxA.partial_predicate || '';
          const predB = idxB.partial_predicate || '';

          if (colsA === colsB && predA === predB && idxA.is_unique === idxB.is_unique) {
            duplicateIndexes.push({
              table: tableName,
              index1: idxA.index_name,
              index2: idxB.index_name,
              columns: colsA,
              unique: idxA.is_unique,
            });
          } else if (predA === '' && predB === '') {
            // Check prefix redundancy: e.g. A has (col1) and B has (col1, col2)
            if (idxA.column_names.length < idxB.column_names.length) {
              const isPrefix = idxA.column_names.every((c: string, idx: number) => c === idxB.column_names[idx]);
              if (isPrefix && !idxA.is_unique) {
                redundantIndexes.push({
                  table: tableName,
                  redundantIndex: idxA.index_name,
                  coveringIndex: idxB.index_name,
                  redundantCols: colsA,
                  coveringCols: colsB,
                });
              }
            } else if (idxB.column_names.length < idxA.column_names.length) {
              const isPrefix = idxB.column_names.every((c: string, idx: number) => c === idxA.column_names[idx]);
              if (isPrefix && !idxB.is_unique) {
                redundantIndexes.push({
                  table: tableName,
                  redundantIndex: idxB.index_name,
                  coveringIndex: idxA.index_name,
                  redundantCols: colsB,
                  coveringCols: colsA,
                });
              }
            }
          }
        }
      }
    }

    // 5. Unindexed Foreign Keys
    const unindexedFks: any[] = [];
    for (const fk of fkRes.rows) {
      const idxList = tableIndexesMap.get(fk.table_name) || [];
      const hasCoveringIndex = idxList.some(idx => {
        // Leading column of index matches FK column
        return idx.column_names.length > 0 && idx.column_names[0] === fk.column_name;
      });
      if (!hasCoveringIndex) {
        unindexedFks.push({
          table: fk.table_name,
          column: fk.column_name,
          constraintName: fk.constraint_name,
          foreignTable: fk.foreign_table_name,
          foreignColumn: fk.foreign_column_name,
          deleteRule: fk.delete_rule,
        });
      }
    }

    const report = {
      tablesCount: tablesRes.rows.length,
      indexesCount: indexesRes.rows.length,
      foreignKeysCount: fkRes.rows.length,
      duplicateIndexesCount: duplicateIndexes.length,
      redundantIndexesCount: redundantIndexes.length,
      unindexedFksCount: unindexedFks.length,
      duplicateIndexes,
      redundantIndexes,
      unindexedFks,
      tables: tablesRes.rows,
    };

    const outPath = path.resolve('artifacts/primary-db-catalog-audit.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

    console.log(`Audit saved to ${outPath}`);
    console.log(`Duplicate Indexes: ${duplicateIndexes.length}`);
    console.log(`Redundant Indexes: ${redundantIndexes.length}`);
    console.log(`Unindexed Foreign Keys: ${unindexedFks.length}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Catalog inspection failed:', err);
  process.exit(1);
});
