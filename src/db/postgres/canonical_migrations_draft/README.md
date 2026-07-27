# canonical_migrations_draft

This directory is the active domain-based migration source of truth and the staged replacement for `migrations2/`.

Purpose:
- run the domain-based migration architecture through the default bootstrap path
- keep migration responsibilities isolated by bounded context
- allow iterative refactoring until the chain is complete and schema-parity tested

Status:
- active canonical source of truth
- consumed by the current migration runner by default
- safe place to port and normalize migrations from `migrations2/`

Execution:
- `npm run db:migrate` (default canonical path)
- `npm run db:migrate:draft`
- `npm run test:integration -- test/integration/canonical-migrations-draft.test.ts`
- `tsx scripts/setup-db.ts --migrations-profile draft`
- `tsx scripts/setup-db.ts --migrations-dir src/db/postgres/canonical_migrations_draft`

Rules:
- one bounded context per folder
- one responsibility per file
- all project-owned tables live in `04_projects/`
- later connector, alerting, and ingestion folders may add only cross-domain links
- destructive project teardown is manual-only: `04_projects/999_delete_all_project_tables.down.sql`
- shared helpers live only in `00_shared/`
- no loose helper SQL outside numbered migration files
- use UTF-8 and multiline SQL only
