# migrations2 — Consolidated & Corrected Auth Schema

## Why this folder exists

The original `migrations/` folder split the auth schema across **12 partial files**
(`001_initial.sql`, `002_add_audit_logs.sql`, `006_unify_email_token_flows.sql`,
`007_auth_security_hardening.sql`, `008_auth_canonical.sql`, `009_fix_audit_logs_and_email_mfa.sql`,
`010_auth_phase3.sql`, `011_auth_phase4.sql`, `012_auth_phase5.sql`, `013_auth_phase6.sql`,
`014_auth_phase7.sql`, plus the orphaned `authtable.sql`). Several of those files conflict
with one another (duplicate triggers, dropped-then-recreated indexes, a `COMMIT` inside a file
that never opened a `BEGIN` — `006` and `007`), and the orphan `authtable.sql` re-creates the
broken `check_login_attempts()` trigger and RLS policies that `008` explicitly removes.

This folder is a **single, safe-to-run-from-scratch, bug-corrected** snapshot of the auth
schema. It is the authoritative DDL for a fresh database. It does NOT depend on any file in
`migrations/`.

## Files

| File | Purpose |
|------|---------|
| `001_auth_canonical_consolidated.up.sql` | Full auth schema with the bugs below fixed. Idempotent. |
| `001_auth_canonical_consolidated.down.sql` | Clean rollback of everything created by the up file. |
| `002_add_notification_connectors.{up,down}.sql` | Notification connector configs. |
| `003_add_alerting_module.{up,down}.sql` | Alerting rules/incidents. |
| `004_add_analytics_module.{up,down}.sql` | Pulse SDK event + analytics tables. |
| `005_add_mfa_system.{up,down}.sql` | Google-style MFA: extends `user_mfa_devices` (display_hint, encrypted phone, per-device lockout), adds `sms_mfa_otps`, and adds org MFA-policy columns to `organization_settings`. Extends the existing MFA schema — does NOT create a parallel `mfa_devices` family. |
| `BUGFIXES.md` | Point-by-point list of every bug this schema corrects vs. `migrations/`. |

## Bugs corrected (summary — full detail in `BUGFIXES.md`)

1. **`updateUserEmail` wrote a `GENERATED ALWAYS … STORED` column** → removed the write; the
   generated `email_hash` recomputes itself.
2. **`security_event_type` enum drift** → `mfa_recovery_requested` (present in the TS
   `SecurityEventType` union) is now a real enum value, so `recordSecurityEvent` can no longer
   throw a Postgres enum-violation.
3. **Tombstone-on-delete destroys the original email permanently** → the original email is now
   preserved in `original_email` and `restoreUser` semantics recover it.
4. **`authtable.sql` re-introduced the destructive `check_login_attempts()` trigger and the
   non-functional RLS** → not present here; lockout is application-driven.
5. **`006`/`007` emit a stray `COMMIT` with no matching `BEGIN`** → every file here is wrapped
   in a single balanced `BEGIN … COMMIT`.
6. **`audit_logs` schema drift** → one canonical definition matching `audit-logger.ts`.
7. **`idx_users_auth_lookup` referenced `password_hash` in an index** → removed (leaks timing /
   unnecessary); lookup goes through `email_hash`.

## How to apply

```bash
# Fresh DB
psql "$DATABASE_URL" -f migrations2/001_auth_canonical_consolidated.up.sql

# Roll back
psql "$DATABASE_URL" -f migrations2/001_auth_canonical_consolidated.down.sql
```

For an existing DB that already ran `migrations/`, apply `migrations2/` on top — every statement
is guarded with `IF NOT EXISTS` / `IF EXISTS` so it is a no-op on columns that already match.
