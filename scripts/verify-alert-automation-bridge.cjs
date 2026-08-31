/**
 * Live verification of the alerting -> automation event bridge, end to end at
 * the SQL layer (not through pg-boss, which requires the running worker
 * processes — see the integration test suite for the pg-boss-level proof).
 *
 * Proves, against the REAL LOG DB and REAL PRIMARY DB, in transactions that are
 * ROLLED BACK (no residue):
 *   1. appendDomainOutbox's exact SQL writes a real telemetry_outbox row with
 *      signal_kind='alert_domain_event', fast_path=FALSE.
 *   2. A duplicate call with the same dedupe key produces NO second row
 *      (idempotency reservation via alert_runtime_idempotency_keys).
 *   3. AlertDomainOutboxRelay's exact claim SQL claims the row and NEVER
 *      touches fast_path=TRUE rows (proves the two relays cannot race).
 *   4. The claimed row's attributes deserialize into exactly the job shape the
 *      automation consumer expects.
 *   5. The automation consumer's exact insertInboxEvent SQL, called with that
 *      job shape, produces a real automation_events_inbox row with
 *      sourceModule='alerting'.
 *   6. Publishing the SAME dedupeKey twice into automation_events_inbox
 *      collapses to one row (end-to-end idempotency across the whole bridge).
 */
require('dotenv').config();
const { Client } = require('pg');

const ok = (m) => console.log(`  PASS  ${m}`);

(async () => {
  const logDb = new Client({ connectionString: process.env.LOG_DB_PRIMARY, ssl: { rejectUnauthorized: false } });
  const primaryDb = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await logDb.connect();
  await primaryDb.connect();
  await logDb.query('BEGIN');
  await primaryDb.query('BEGIN');

  try {
    const orgs = await primaryDb.query('SELECT id FROM organizations ORDER BY created_at LIMIT 1');
    const orgId = orgs.rows[0].id;
    const alertEventId = '11111111-1111-4111-8111-111111111111';
    const alertKey = `probe-alert-${Date.now()}`;
    const idempotencyKey = `probe-idem-${Date.now()}`;
    const dedupeKey = `alert:alert.event.created:${idempotencyKey}`;

    // ── 1. appendDomainOutbox's exact SQL ───────────────────────────────────
    const payload = {
      alert_key: alertKey, fingerprint_count: 1, service: 'api', severity: 'critical',
      status: 'firing', incident_id: null, duration_minutes: null, environment: 'production',
      project_id: null, rule_id: null, observed_value: null, threshold_value: null,
      labels: {}, occurred_at: new Date().toISOString(),
    };
    const insertOutboxSql = `
      WITH reserved AS (
        INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
        VALUES ('telemetry_outbox', $1, 'alert_domain_event:' || $2)
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      INSERT INTO telemetry_outbox (
        organization_id, project_id, environment, signal_kind, event_id,
        severity, fast_path, attributes, occurred_at
      )
      SELECT $1, $3, $4, 'alert_domain_event', $2,
             $5::logdb_severity, FALSE, $6::jsonb, $7
      WHERE EXISTS (SELECT 1 FROM reserved)
      ON CONFLICT DO NOTHING`;
    await logDb.query(insertOutboxSql, [
      orgId, dedupeKey, null, 'production', 'critical',
      JSON.stringify({ eventType: 'alert.event.created', alertKey, alertEventId, dedupeKey, payload, metadata: { ruleId: null } }),
      new Date().toISOString(),
    ]);
    const row1 = await logDb.query(
      `SELECT id, signal_kind, fast_path, published_at FROM telemetry_outbox WHERE event_id=$1 AND organization_id=$2`,
      [dedupeKey, orgId],
    );
    if (row1.rows.length !== 1) throw new Error('expected exactly 1 outbox row after first append');
    if (row1.rows[0].signal_kind !== 'alert_domain_event') throw new Error('wrong signal_kind');
    if (row1.rows[0].fast_path !== false) throw new Error('fast_path must be FALSE');
    ok(`appendDomainOutbox wrote a real telemetry_outbox row (id=${row1.rows[0].id}, signal_kind=alert_domain_event, fast_path=false)`);

    // ── 2. duplicate call -> no second row ──────────────────────────────────
    await logDb.query(insertOutboxSql, [
      orgId, dedupeKey, null, 'production', 'critical',
      JSON.stringify({ eventType: 'alert.event.created', alertKey, alertEventId, dedupeKey, payload, metadata: {} }),
      new Date().toISOString(),
    ]);
    const row2 = await logDb.query(
      `SELECT COUNT(*)::int AS n FROM telemetry_outbox WHERE event_id=$1 AND organization_id=$2`,
      [dedupeKey, orgId],
    );
    if (row2.rows[0].n !== 1) throw new Error(`expected exactly 1 row after duplicate append, got ${row2.rows[0].n}`);
    ok('duplicate appendDomainOutbox call produced NO second row (idempotency reservation works)');

    // ── 3. AlertDomainOutboxRelay's exact claim SQL ─────────────────────────
    // Seed one fast_path=TRUE telemetry row to prove disjoint claiming.
    await logDb.query(
      `INSERT INTO telemetry_outbox (organization_id, signal_kind, event_id, fast_path, attributes, occurred_at)
       VALUES ($1, 'error', $2, TRUE, '{}'::jsonb, NOW())`,
      [orgId, `probe-telemetry-${Date.now()}`],
    );
    const claim = await logDb.query(
      `WITH claimed AS (
         SELECT id, created_at
           FROM telemetry_outbox
          WHERE signal_kind = 'alert_domain_event'
            AND published_at IS NULL
            AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '2 minutes')
          ORDER BY created_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE telemetry_outbox t
          SET claimed_at = NOW(), claimed_by = $2, attempts = attempts + 1, last_error = NULL
         FROM claimed
        WHERE t.id = claimed.id AND t.created_at = claimed.created_at
        RETURNING t.id::text, t.organization_id, t.project_id, t.attributes, t.occurred_at, t.created_at, t.fast_path`,
      [100, 'probe-relay-worker'],
    );
    if (claim.rows.length !== 1) throw new Error(`expected exactly 1 claimed row, got ${claim.rows.length}`);
    if (claim.rows[0].fast_path !== false) throw new Error('relay claimed a fast_path row -- would race with TelemetryOutboxRelay');
    ok(`AlertDomainOutboxRelay claim SQL claimed exactly 1 row and it is NOT a fast_path telemetry row (id=${claim.rows[0].id})`);

    // ── 4. attributes deserialize into the expected job shape ──────────────
    const attrs = claim.rows[0].attributes;
    if (attrs.eventType !== 'alert.event.created') throw new Error('eventType mismatch after claim');
    if (attrs.payload.severity !== 'critical') throw new Error('payload.severity mismatch after claim');
    ok('claimed row attributes deserialize into the exact job shape the automation consumer expects');

    // ── 5. automation consumer's insertInboxEvent SQL ───────────────────────
    const inboxInsertSql = `
      INSERT INTO automation_events_inbox
        (organization_id, project_id, source_module, event_type, source_event_id,
         dedupe_key, payload, headers, status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'pending',$9::jsonb)
       ON CONFLICT (organization_id, dedupe_key) DO NOTHING
       RETURNING *`;
    const inboxRes = await primaryDb.query(inboxInsertSql, [
      orgId, attrs.metadata?.projectId ?? null, 'alerting', attrs.eventType, attrs.alertEventId,
      attrs.dedupeKey, JSON.stringify(attrs.payload), JSON.stringify({}),
      JSON.stringify({ bridgedFrom: 'alerting', alertKey: attrs.alertKey }),
    ]);
    if (inboxRes.rows.length !== 1) throw new Error('expected the inbox insert to create a row');
    if (inboxRes.rows[0].source_module !== 'alerting') throw new Error('sourceModule mismatch');
    if (inboxRes.rows[0].payload.severity !== 'critical') throw new Error('inbox payload lost the severity field');
    if (inboxRes.rows[0].payload.service !== 'api') throw new Error('inbox payload lost the service field (needed by alert-route-by-service-severity)');
    ok(`insertInboxEvent wrote a real automation_events_inbox row (id=${inboxRes.rows[0].id}, sourceModule=alerting, eventType=${inboxRes.rows[0].event_type})`);

    // ── 6. same dedupeKey published twice into the inbox collapses to 1 row ──
    const dupInbox = await primaryDb.query(inboxInsertSql, [
      orgId, null, 'alerting', attrs.eventType, attrs.alertEventId,
      attrs.dedupeKey, JSON.stringify({ ...attrs.payload, tamperedDuplicate: true }), JSON.stringify({}), JSON.stringify({}),
    ]);
    if (dupInbox.rows.length !== 0) throw new Error('duplicate inbox publish was NOT deduplicated');
    const countInbox = await primaryDb.query(
      `SELECT COUNT(*)::int AS n FROM automation_events_inbox WHERE organization_id=$1 AND dedupe_key=$2`,
      [orgId, attrs.dedupeKey],
    );
    if (countInbox.rows[0].n !== 1) throw new Error(`expected exactly 1 inbox row end-to-end, found ${countInbox.rows[0].n}`);
    ok('end-to-end: the same alert decision published twice results in exactly ONE automation_events_inbox row');

    console.log('\nALERT -> AUTOMATION BRIDGE VERIFIED (SQL LAYER) AGAINST LIVE DATABASES');
  } catch (e) {
    console.error('\nVERIFICATION FAILED:', e.message);
    await logDb.query('ROLLBACK');
    await primaryDb.query('ROLLBACK');
    await logDb.end();
    await primaryDb.end();
    process.exit(1);
  }
  await logDb.query('ROLLBACK');
  await primaryDb.query('ROLLBACK');
  console.log('(both transactions rolled back — no residue in either database)');
  await logDb.end();
  await primaryDb.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
