# Pulse

See [docs/enterprise-auth-implementation-plan.md](docs/enterprise-auth-implementation-plan.md) for the enterprise-grade backend remediation plan.

## Current Direction

- Canonical SQL source of truth: `src/db/postgres/canonical_migrations_draft` (the default migration runner path).
- Legacy compatibility path: `src/db/postgres/migrations2` until the rename is completed everywhere.
- Auth and control-plane components must remain Redis-free for the initial stage.
- Use in-memory LRU only for short-lived single-process state and Postgres for durable/shared state.
- Security, schema bootstrap, and operability fixes come before feature expansion.
