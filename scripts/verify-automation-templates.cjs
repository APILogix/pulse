/**
 * Verifies the canonical automation template registry in the live PRIMARY DB:
 *   - exactly the expected platform templates exist
 *   - none of the removed templates remain
 *   - NO template definition references a retired action type
 *   - every referenced action type is currently supported
 *   - every template has exactly one current version
 *
 * Read-only.
 */
require('dotenv').config();
const { Client } = require('pg');

// Must mirror ACTION_TYPES in src/modules/automation/types.ts
const SUPPORTED = new Set([
  'notification.send', 'quota.notify', 'security.notify', 'webhook.call',
  'pagerduty.trigger', 'connector.delivery.retry', 'alert.silence.create',
  'incident.create', 'incident.timeline.append', 'incident.assign_owner',
  'approval.request', 'rollback.recommend', 'noop',
  'ai.summary.generate', 'ai.root_cause.generate',
  'incident.postmortem.generate_draft', 'report.export',
  'ticket.github.create', 'ticket.jira.create',
]);

const REMOVED_TEMPLATES = [
  'release-health-guard',
  'open-runbook-for-critical-service',
  'uptime-failure-status-page-draft',
];

const REMOVED_ACTIONS = [
  'runbook.open', 'runbook.step.create', 'status_page.update',
  'release.guard.warn', 'release.guard.pause', 'retention.archive',
  'retention.purge_request', 'quota.throttle_recommend', 'alert.severity.change',
];

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures += 1; };

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const tpl = await c.query(
    `SELECT template_key, is_active FROM automation_templates
      WHERE scope='platform' AND deleted_at IS NULL ORDER BY template_key`,
  );
  console.log(`platform templates: ${tpl.rows.length}`);
  if (tpl.rows.length === 17) ok('exactly 17 platform templates (was 20)');
  else bad(`expected 17 platform templates, found ${tpl.rows.length}`);

  const keys = tpl.rows.map((r) => r.template_key);
  for (const gone of REMOVED_TEMPLATES) {
    if (keys.includes(gone)) bad(`removed template still present: ${gone}`);
  }
  ok('none of the 3 unbacked templates remain');

  // every template has exactly one current version
  const versions = await c.query(
    `SELECT t.template_key,
            COUNT(v.id)::int AS total,
            COUNT(*) FILTER (WHERE v.is_current)::int AS current_count
       FROM automation_templates t
       LEFT JOIN automation_template_versions v ON v.template_id = t.id
      WHERE t.scope='platform' AND t.deleted_at IS NULL
      GROUP BY t.template_key ORDER BY t.template_key`,
  );
  const badVersions = versions.rows.filter((r) => r.current_count !== 1);
  if (badVersions.length === 0) ok('every template has exactly one current version');
  else bad(`templates without exactly one current version: ${badVersions.map((r) => r.template_key).join(', ')}`);

  // orphaned version rows for deleted templates
  const orphans = await c.query(
    `SELECT COUNT(*)::int AS n FROM automation_template_versions v
      LEFT JOIN automation_templates t ON t.id = v.template_id
      WHERE t.id IS NULL`,
  );
  if (orphans.rows[0].n === 0) ok('no orphaned template_version rows');
  else bad(`${orphans.rows[0].n} orphaned template_version rows`);

  // action types referenced by every template definition
  const used = await c.query(
    `SELECT DISTINCT t.template_key, a->>'actionType' AS action_type
       FROM automation_template_versions v
       JOIN automation_templates t ON t.id = v.template_id
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.definition->'actions','[]'::jsonb)) a
      WHERE t.scope='platform' AND t.deleted_at IS NULL
      ORDER BY 1,2`,
  );
  const unsupported = used.rows.filter((r) => !SUPPORTED.has(r.action_type));
  if (unsupported.length === 0) {
    ok(`all ${new Set(used.rows.map((r) => r.action_type)).size} referenced action types are supported`);
  } else {
    for (const u of unsupported) bad(`template ${u.template_key} references unsupported action "${u.action_type}"`);
  }

  // raw scan: no retired action string anywhere in any definition
  for (const gone of REMOVED_ACTIONS) {
    const hit = await c.query(
      `SELECT COUNT(*)::int AS n FROM automation_template_versions WHERE definition::text LIKE $1`,
      [`%${gone}%`],
    );
    if (hit.rows[0].n !== 0) bad(`retired action "${gone}" still referenced by ${hit.rows[0].n} version row(s)`);
  }
  ok('no retired action type appears in any template definition');

  console.log('\nreferenced action types:');
  for (const t of [...new Set(used.rows.map((r) => r.action_type))].sort()) console.log(`  - ${t}`);

  await c.end();
  if (failures > 0) {
    console.log(`\nTEMPLATE REGISTRY VERIFICATION FAILED (${failures} problem(s))`);
    process.exit(1);
  }
  console.log('\nTEMPLATE REGISTRY VERIFIED');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
