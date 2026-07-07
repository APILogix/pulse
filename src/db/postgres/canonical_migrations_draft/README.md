# canonical_migrations_draft

This directory is the staged replacement for `migrations2/`.

Purpose:
- build the new domain-based migration architecture without changing the live bootstrap path yet
- keep migration responsibilities isolated by bounded context
- allow iterative refactoring until the chain is complete and schema-parity tested

Status:
- draft only
- not consumed by the current migration runner
- safe place to port and normalize migrations from `migrations2/`

Execution:
- `npm run db:migrate:draft`
- `npm run test:integration -- test/integration/canonical-migrations-draft.test.ts`
- `tsx scripts/setup-db.ts --migrations-profile draft`
- `tsx scripts/setup-db.ts --migrations-dir src/db/postgres/canonical_migrations_draft`

Rules:
- one bounded context per folder
- one responsibility per file
- shared helpers live only in `00_shared/`
- no loose helper SQL outside numbered migration files
- use UTF-8 and multiline SQL only
