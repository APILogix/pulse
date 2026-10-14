#!/usr/bin/env tsx
/**
 * Bootstrap PrimaryDB and LogDB by executing modular SQL schema files table-by-table.
 *
 * Delegates to the unified modular runner in scripts/run-modular-schema.ts.
 * Replaces monolithic schema.sql execution with clean, ordered, file-by-file execution
 * directly from canonical modular schema directories under `database/primarydbv2/schema`
 * and `database/logdbv2/schema`.
 */
import { run } from './run-modular-schema.js';

run().catch((err) => {
  console.error('\n❌ Bootstrap failed:', err.message || err);
  process.exit(1);
});
