-- =============================================================================
-- Remove the three platform automation templates whose purpose depends on an
-- entity that does not exist in this product.
--
-- WHY (evidence in docs/automationv2/24-action-inventory-and-decisions.md):
--   release-health-guard              uses release.guard.warn, which is a duplicate
--                                     of notification.send; its release.health_degraded
--                                     trigger also has no producer.
--   open-runbook-for-critical-service uses runbook.open; a live search for runbook%
--                                     tables returned NO TABLES — there is no runbook
--                                     entity anywhere in the schema or codebase.
--   uptime-failure-status-page-draft  uses status_page.update; status_page% returned
--                                     NO TABLES, and there is no `uptime` module in
--                                     src/modules either, so it is doubly unbacked.
--
--   All three reference action types that have been removed from ACTION_TYPES, so a
--   workflow created from these templates would now be rejected at validation time.
--   Leaving the templates in place would offer users a starting point that cannot be
--   saved, let alone executed.
--
-- SAFETY:
--   Deletes are keyed on template_key AND scope='platform', so an organization's own
--   templates are never touched. Ordering removes version rows before template rows
--   to respect the FK. Guarded so any tenant-authored workflow already created from a
--   template is unaffected: automation_workflows.template_id is ON DELETE SET NULL,
--   and no live workflows existed at the time this was written (automation_workflows
--   was empty), so no user work is lost.
--
-- Idempotent: safe to re-run; deletes simply match zero rows the second time.
-- =============================================================================

BEGIN;

DELETE FROM automation_template_versions
 WHERE template_id IN (
   SELECT id FROM automation_templates
    WHERE scope = 'platform'
      AND template_key IN (
        'release-health-guard',
        'open-runbook-for-critical-service',
        'uptime-failure-status-page-draft'
      )
 );

DELETE FROM automation_templates
 WHERE scope = 'platform'
   AND template_key IN (
     'release-health-guard',
     'open-runbook-for-critical-service',
     'uptime-failure-status-page-draft'
   );

COMMIT;
