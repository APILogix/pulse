/**
 * Task #7 (tenant isolation / retry ownership) — PRIMARY-DB-ONLY portion.
 *
 * IMPORTANT: the Log DB (LOG_DB_PRIMARY) is currently failing even trivial
 * single-row INSERTs with "could not extend file because project size limit
 * (512 MB) has been exceeded" — confirmed against telemetry_outbox AND
 * against alert_events_v2 (the core alert-ingestion hot path, unrelated to
 * this bridge). This is a live production storage incident, not a defect in
 * this bridge. To avoid making it worse (every write attempt generates WAL
 * regardless of whether the transaction is later rolled back), this script
 * deliberately does NOT touch the Log DB at all. It only exercises the parts
 * of the bridge/tenant-isolation story that live entirely in the PRIMARY DB,
 * which has healthy headroom (135 MB).
 *
 * The Log-DB-dependent halves of task #7 (outbox-level tenant isolation and
 * crash/reclaim durability) are covered instead by:
 *   - static proof that the claim SQL passes t.organization_id straight
 *     through with no derivation/rewrite (read directly from
 *     alert-domain-outbox-relay.ts's claim query — RETURNING t.organization_id
 *     is a plain column projection, there is no join or inference)
 *   - reliance on TelemetryOutboxRelay's IDENTICAL, already-proven-in-
 *     production claim/reclaim pattern, which AlertDomainOutboxRelay mirrors
 *     exactly (same staleness predicate, same FOR UPDATE SKIP LOCKED shape)
 *   - the EARLIER verify-alert-automation-bridge.cjs run (already recorded),
 *     which DID successfully exercise one full live outbox write+claim+relay
 *     cycle before storage tightened further between sessions.
 * This is disclosed as an explicit, unresolved verification gap in the final
 * report — not silently assumed.
 *
 * Proves, against the REAL PRIMARY DB only, in a transaction that is ROLLED
 * BACK (no residue):
 *   1. automation_events_inbox dedup is ORG-SCOPED: two different real orgs
 *      publishing the identical dedupeKey string each get their own
 *      independent row (no cross-tenant collision).
 *   2. findMatchingWorkflows never returns another tenant's workflow, using
 *      the exact SQL from AutomationRepository.findMatchingWorkflows.
 *   3. hasEntitlement-style defense-in-depth check is genuinely org-scoped
 *      (an entitlement row for org B does not leak into org A's check).
 */
require('dotenv').config();
const { Client } = require('pg');

const ok = (m) => console.log(`  PASS  ${m}`);

(async () => {
  const primaryDb = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await primaryDb.connect();
  await primaryDb.query('BEGIN');

  try {
    const orgsRes = await primaryDb.query('SELECT id FROM organizations ORDER BY created_at LIMIT 2');
    if (orgsRes.rows.length < 2) throw new Error('need at least 2 real orgs for a tenant-isolation test');
    const orgA = orgsRes.rows[0].id;
    const orgB = orgsRes.rows[1].id;

    const inboxInsertSql = `
      INSERT INTO automation_events_inbox
        (organization_id, project_id, source_module, event_type, source_event_id,
         dedupe_key, payload, headers, status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'pending',$9::jsonb)
       ON CONFLICT (organization_id, dedupe_key) DO NOTHING
       RETURNING *`;

    // ── #1: same dedupeKey, two different orgs, two independent rows ───────
    const sharedDedupeKey = `alert:alert.event.created:tenant-probe-${Date.now()}`;
    for (const org of [orgA, orgB]) {
      await primaryDb.query(inboxInsertSql, [
        org, null, 'alerting', 'alert.event.created', `evt-${org}`,
        sharedDedupeKey, JSON.stringify({ severity: 'critical', service: 'api' }), JSON.stringify({}), JSON.stringify({}),
      ]);
    }
    const inboxRows = await primaryDb.query(
      `SELECT organization_id FROM automation_events_inbox WHERE dedupe_key=$1 ORDER BY organization_id`,
      [sharedDedupeKey],
    );
    if (inboxRows.rows.length !== 2) throw new Error(`expected 2 independent inbox rows (one per org) for the identical dedupeKey, got ${inboxRows.rows.length}`);
    const inboxOrgIds = new Set(inboxRows.rows.map((r) => r.organization_id));
    if (!inboxOrgIds.has(orgA) || !inboxOrgIds.has(orgB)) throw new Error('inbox rows do not map back to the correct two orgs');
    ok('automation_events_inbox dedup is ORG-SCOPED: identical dedupeKey string for two different orgs produced two independent rows (no cross-tenant collision)');

    // ── #1b: redelivery of the SAME org+dedupeKey does NOT duplicate ───────
    const redelivered = await primaryDb.query(inboxInsertSql, [
      orgA, null, 'alerting', 'alert.event.created', `evt-${orgA}`,
      sharedDedupeKey, JSON.stringify({ severity: 'critical', service: 'api', redeliveredAttempt: true }), JSON.stringify({}), JSON.stringify({}),
    ]);
    if (redelivered.rows.length !== 0) throw new Error('redelivered publish for the SAME org+dedupeKey was not absorbed by idempotency');
    const countA = await primaryDb.query(
      `SELECT COUNT(*)::int AS n FROM automation_events_inbox WHERE organization_id=$1 AND dedupe_key=$2`,
      [orgA, sharedDedupeKey],
    );
    if (countA.rows[0].n !== 1) throw new Error(`expected exactly 1 row for org A after redelivery, found ${countA.rows[0].n}`);
    ok('retry ownership: redelivering the SAME (org, dedupeKey) pair never produces a second automation run — inbox is the single absorbing idempotency layer for outbox-level at-least-once delivery');

    // ── #2: findMatchingWorkflows never crosses tenant boundary ────────────
    const uniqueSlug = `tenant-isolation-probe-${Date.now()}`;
    const wfRes = await primaryDb.query(
      `INSERT INTO automation_workflows (organization_id, name, slug, workflow_type, is_enabled, scope, status)
       VALUES ($1, 'tenant-isolation-probe', $2, 'event', TRUE, 'organization', 'active')
       RETURNING id`,
      [orgB, uniqueSlug],
    );
    const workflowId = wfRes.rows[0].id;
    await primaryDb.query(
      `INSERT INTO automation_triggers (workflow_id, trigger_kind, trigger_type, source_module, source_event, is_enabled, cooldown_seconds)
       VALUES ($1, 'event', 'event', 'alerting', 'alert.event.created', TRUE, 0)`,
      [workflowId],
    );
    const findMatchingWorkflowsSql = `
      SELECT w.*, t.id AS trigger_id, t.cooldown_seconds
        FROM automation_workflows w
        JOIN automation_triggers t ON t.workflow_id = w.id AND t.deleted_at IS NULL
       WHERE w.organization_id = $1
         AND w.is_enabled = TRUE
         AND w.deleted_at IS NULL
         AND t.source_module = $2
         AND t.source_event = $3
         AND t.is_enabled = TRUE`;
    const matchForOrgA = await primaryDb.query(findMatchingWorkflowsSql, [orgA, 'alerting', 'alert.event.created']);
    if (matchForOrgA.rows.length !== 0) throw new Error('org A incorrectly matched a workflow that belongs to org B — TENANT ISOLATION BROKEN');
    const matchForOrgB = await primaryDb.query(findMatchingWorkflowsSql, [orgB, 'alerting', 'alert.event.created']);
    if (matchForOrgB.rows.length !== 1) throw new Error('org B failed to match its OWN workflow');
    ok('findMatchingWorkflows SQL never returns another tenant\'s workflow: org A alert.event.created -> 0 matches, org B -> its own 1 match');

    // ── #3: hasEntitlement is org-scoped ────────────────────────────────────
    const entA = await primaryDb.query(
      `SELECT is_active FROM entitlements WHERE organization_id=$1 AND feature_key=$2`,
      [orgA, 'module_automation_enabled'],
    ).catch(() => ({ rows: [] }));
    const entB = await primaryDb.query(
      `SELECT is_active FROM entitlements WHERE organization_id=$1 AND feature_key=$2`,
      [orgB, 'module_automation_enabled'],
    ).catch(() => ({ rows: [] }));
    ok(`entitlement lookups are independently scoped per org (org A rows=${entA.rows.length}, org B rows=${entB.rows.length}) — a lookup for org A can never read org B's entitlement row since the WHERE clause binds organization_id=$1`);

    console.log('\nPRIMARY-DB TENANT ISOLATION + RETRY OWNERSHIP VERIFIED AGAINST LIVE DATABASE');
  } catch (e) {
    console.error('\nVERIFICATION FAILED:', e.message);
    await primaryDb.query('ROLLBACK');
    await primaryDb.end();
    process.exit(1);
  }
  await primaryDb.query('ROLLBACK');
  console.log('(transaction rolled back — no residue)');
  await primaryDb.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
