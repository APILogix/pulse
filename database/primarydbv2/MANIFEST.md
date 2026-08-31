# PrimaryDB v2 manifest

`schema.sql` and `migrations/000001_create_schema.up.sql` are copies of the final primary baseline at `src/db/postgres/primary_db_draft/schema.sql`; they are executable PostgreSQL schema files, not psql include manifests. `migrations/000001_create_schema.down.sql` intentionally aborts rather than performing an unsafe data-destructive reversal.

`seeds/` copies the 13 executable `.sql` files from `src/db/postgres/primary_db_draft/20_seeders/` in deterministic lexical/numeric order. The JSON preview artifact is deliberately excluded. Run the baseline first, then run seed files in filename order.

Automation belongs to PrimaryDB: the baseline includes its primary control-plane and runtime schema and the final template-registry seed. Lifecycle scripts operate only on `current_schema()` application relations, explicitly exclude common migration ledger names, and use no `CASCADE` so unexpected ledger dependencies fail safely.
