# LogDB v2 manifest

`schema.sql` and `migrations/000001_create_schema.up.sql` consolidate ordered forward sources from `database/migrations/logdb/` into executable PostgreSQL SQL; they are not psql include manifests. The source order follows numbered directories and filenames, including uncommitted `07_outbox/004_alert_domain_outbox_signal_kind.up.sql` and the final-state decision in `08_automation_runtime/002_drop_misplaced_automation_runtime.up.sql`. The latter means the temporary LogDB automation tables are intentionally absent from this final-state bootstrap, so that create/drop pair is not emitted.

The final LogDB environment contract is `TEXT` (SDK environment string), with the final validation/metadata corrections from `10_lookup/003_environment_string_contract.up.sql` and `004_relax_typed_event_metadata_environment_contract.up.sql`. The outbox retains `alert_domain_event` as a valid `signal_kind`.

There is no authoritative LogDB seed data; `seeds/000001_noop.sql` is an executable no-op. The down script intentionally aborts rather than reverse a consolidated baseline. Lifecycle scripts operate only on `current_schema()` application relations, explicitly exclude common migration ledger names, and use no `CASCADE` so unexpected ledger dependencies fail safely.
