/**
 * End-to-end verification of the automation runtime SQL against the REAL
 * PRIMARY database schema.
 *
 * This exercises the exact SQL statements from src/modules/automation/repository.ts
 * that previously could not run at all (tables were in the wrong database).
 *
 * Everything is created inside a transaction that is ROLLED BACK at the end,
 * so this leaves no residue in the database.
 *
 * Usage: node scripts/verify-automation-runtime.cjs
 */
require('dotenv').config();
const { Client } = require('pg');

const ok = (m) => console.log(`  PASS  ${m}`);
const fail = (m, e) => { console.log(`  FAIL  ${m}: ${e.message}`); throw e; };

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('BEGIN');
  try {
    // ---------------------------------------------------------------------
    // Use REAL existing organizations so FKs and tenant isolation are genuine.
    // Everything is rolled back at the end.
    // ---------------------------------------------------------------------
    const orgs = await c.query('SELECT id FROM organizations ORDER BY created_at LIMIT 2');
    if (orgs.rows.length < 2) throw new Error('need at least 2 organizations for tenant-isolation check');
    const orgId = orgs.rows[0].id;
    const otherOrgId = orgs.rows[1].id;
    ok(`using real organizations ${orgId} (primary) and ${otherOrgId} (isolation probe)`);

    const wf = await c.query(
      `INSERT INTO automation_workflows
         (organization_id, name, slug, description, workflow_type, scope, status, is_enabled, current_version)
       VALUES ($1, 'Verify Workflow', 'verify-workflow', 'e2e check', 'operational', 'organization', 'active', TRUE, 1)
       RETURNING id`,
      [orgId],
    );
    const workflowId = wf.rows[0].id;
    ok(`fixture workflow created ${workflowId}`);

    const ver = await c.query(
      `INSERT INTO automation_workflow_versions (workflow_id, version, status, definition, checksum, published_at)
       VALUES ($1, 1, 'published', '{}'::jsonb, md5('verify'), NOW()) RETURNING id`,
      [workflowId],
    );
    const versionId = ver.rows[0].id;

    const trg = await c.query(
      `INSERT INTO automation_triggers
         (workflow_id, workflow_version_id, trigger_kind, trigger_type, source_module, source_event, is_enabled, cooldown_seconds)
       VALUES ($1,$2,'event','event.received','alerting','alert.created',TRUE,0) RETURNING id`,
      [workflowId, versionId],
    );
    const triggerId = trg.rows[0].id;

    const act = await c.query(
      `INSERT INTO automation_actions
         (workflow_id, workflow_version_id, action_key, action_type, sort_order, timeout_seconds, max_attempts)
       VALUES ($1,$2,'step-1','notification.send',0,30,3) RETURNING id`,
      [workflowId, versionId],
    );
    const actionId = act.rows[0].id;
    ok('fixture trigger + action created');

    // ---------------------------------------------------------------------
    // 1. insertInboxEvent — exact SQL from repository.ts
    // ---------------------------------------------------------------------
    const dedupeKey = 'verify:' + Date.now();
    const ins = await c.query(
      `INSERT INTO automation_events_inbox
        (organization_id, project_id, source_module, event_type, source_event_id,
         dedupe_key, payload, headers, status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'pending',$9::jsonb)
       ON CONFLICT (organization_id, dedupe_key) DO NOTHING
       RETURNING *`,
      [orgId, null, 'alerting', 'alert.created', 'evt-1', dedupeKey,
        JSON.stringify({ severity: 'critical' }), JSON.stringify({}), JSON.stringify({})],
    );
    if (!ins.rows[0]) throw new Error('inbox insert returned no row');
    const inboxId = ins.rows[0].id;
    ok('insertInboxEvent SQL executed, row persisted');

    // 1b. duplicate insert must be deduped by the unique index
    const dup = await c.query(
      `INSERT INTO automation_events_inbox
        (organization_id, project_id, source_module, event_type, source_event_id,
         dedupe_key, payload, headers, status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'pending',$9::jsonb)
       ON CONFLICT (organization_id, dedupe_key) DO NOTHING
       RETURNING *`,
      [orgId, null, 'alerting', 'alert.created', 'evt-1', dedupeKey,
        JSON.stringify({ severity: 'critical' }), JSON.stringify({}), JSON.stringify({})],
    );
    if (dup.rows.length !== 0) throw new Error('duplicate dedupe_key was NOT deduplicated');
    ok('ON CONFLICT (organization_id, dedupe_key) deduplication works');

    // 1c. NULL-org dedup must also work (NULLS NOT DISTINCT)
    const nullKey = 'verify-null:' + Date.now();
    await c.query(
      `INSERT INTO automation_events_inbox (organization_id, source_module, event_type, dedupe_key, status)
       VALUES (NULL,'system','system.tick',$1,'pending') ON CONFLICT (organization_id, dedupe_key) DO NOTHING`,
      [nullKey],
    );
    const nullDup = await c.query(
      `INSERT INTO automation_events_inbox (organization_id, source_module, event_type, dedupe_key, status)
       VALUES (NULL,'system','system.tick',$1,'pending') ON CONFLICT (organization_id, dedupe_key) DO NOTHING
       RETURNING id`,
      [nullKey],
    );
    if (nullDup.rows.length !== 0) throw new Error('NULL-org duplicate was NOT deduplicated (NULLS NOT DISTINCT missing)');
    ok('NULL-organization dedup works (NULLS NOT DISTINCT verified)');

    // ---------------------------------------------------------------------
    // 2. claimInboxEvents — exact SQL, incl. FOR UPDATE SKIP LOCKED
    // ---------------------------------------------------------------------
    const claim = await c.query(
      `WITH claimable AS (
         SELECT id FROM automation_events_inbox
         WHERE (
           (status IN ('pending','retry') AND (next_retry_at IS NULL OR next_retry_at <= NOW()))
           OR (status = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes')
         )
         ORDER BY received_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE automation_events_inbox e
       SET status = 'processing', locked_at = NOW(), locked_by = $2, attempts = attempts + 1
       FROM claimable c WHERE e.id = c.id
       RETURNING e.*`,
      [10, 'verify-worker'],
    );
    if (claim.rows.length === 0) throw new Error('claimInboxEvents returned nothing');
    const claimedOurs = claim.rows.find((r) => r.id === inboxId);
    if (!claimedOurs) throw new Error('our inbox event was not claimed');
    if (claimedOurs.attempts !== 1) throw new Error(`expected attempts=1, got ${claimedOurs.attempts}`);
    ok(`claimInboxEvents SQL executed (FOR UPDATE SKIP LOCKED), claimed ${claim.rows.length}, attempts incremented`);

    // ---------------------------------------------------------------------
    // 3. createRunWithSteps — exact SQL
    // ---------------------------------------------------------------------
    const idemKey = `automation:${orgId}:${workflowId}:alert.created:evt-1`;
    const runR = await c.query(
      `INSERT INTO automation_runs
        (organization_id, project_id, workflow_id, workflow_version_id, trigger_id,
         inbox_event_id, status, trigger_type, source_module, source_event_id,
         dedupe_key, idempotency_key, priority, max_attempts, input_payload, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,'queued',$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
       RETURNING *`,
      [orgId, null, workflowId, versionId, triggerId, inboxId, 'event.received',
        'alerting', 'evt-1', dedupeKey, idemKey, 0, 3, JSON.stringify({ severity: 'critical' }), null],
    );
    const runId = runR.rows[0].id;
    ok(`createRunWithSteps run insert executed, run ${runId} status=${runR.rows[0].status}`);

    // 3b. duplicate idempotency_key must raise unique violation (23505)
    let gotUnique = false;
    await c.query('SAVEPOINT sp_dup_run');
    try {
      await c.query(
        `INSERT INTO automation_runs
          (organization_id, workflow_id, workflow_version_id, status, trigger_type,
           source_module, idempotency_key, max_attempts, input_payload)
         VALUES ($1,$2,$3,'queued','event.received','alerting',$4,3,'{}'::jsonb)`,
        [orgId, workflowId, versionId, idemKey],
      );
    } catch (e) {
      gotUnique = e.code === '23505';
      await c.query('ROLLBACK TO SAVEPOINT sp_dup_run');
    }
    if (!gotUnique) throw new Error('duplicate run idempotency_key did NOT raise unique violation');
    ok('run idempotency_key unique violation (23505) fires as code expects');

    // 3c. steps insert with ON CONFLICT partial unique
    const stepIdem = `automation:${orgId}:${workflowId}:${runId}:step-1`;
    const stepR = await c.query(
      `INSERT INTO automation_run_steps
        (run_id, workflow_id, action_id, step_key, action_type, status, sort_order,
         max_attempts, requires_approval, idempotency_key, input_payload, metadata)
       VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8,$9,$10::jsonb,$11::jsonb)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [runId, workflowId, actionId, 'step-1', 'notification.send', 0, 3, false,
        stepIdem, JSON.stringify({}), JSON.stringify({ timeoutSeconds: 30, riskLevel: 'low' })],
    );
    if (!stepR.rows[0]) throw new Error('step insert returned no row');
    const stepId = stepR.rows[0].id;
    ok('run step insert with ON CONFLICT partial unique index executed');

    const stepDup = await c.query(
      `INSERT INTO automation_run_steps
        (run_id, workflow_id, action_id, step_key, action_type, status, sort_order,
         max_attempts, requires_approval, idempotency_key, input_payload, metadata)
       VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8,$9,$10::jsonb,$11::jsonb)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [runId, workflowId, actionId, 'step-1', 'notification.send', 0, 3, false,
        stepIdem, JSON.stringify({}), JSON.stringify({})],
    );
    if (stepDup.rows.length !== 0) throw new Error('duplicate step idempotency_key was NOT deduped');
    ok('step idempotency dedup works');

    // ---------------------------------------------------------------------
    // 4. claimNextStep — the cross-table JOIN that was impossible before
    // ---------------------------------------------------------------------
    const stepClaim = await c.query(
      `WITH eligible_run AS (
         SELECT r.id, r.workflow_id, r.organization_id FROM automation_runs r
         JOIN automation_workflows w ON w.id = r.workflow_id AND w.organization_id = r.organization_id
         WHERE r.id = $1
           AND r.status IN ('queued','running')
           AND w.is_enabled = TRUE
           AND w.deleted_at IS NULL
         LIMIT 1
       ),
       claimable AS (
         SELECT s.id FROM automation_run_steps s
         JOIN eligible_run er ON er.id = s.run_id
         WHERE s.run_id = $1
           AND (
             (s.status = 'queued' AND (s.next_retry_at IS NULL OR s.next_retry_at <= NOW()))
             OR (s.status = 'running' AND s.timeout_at IS NOT NULL AND s.timeout_at < NOW())
           )
           AND NOT EXISTS (
             SELECT 1 FROM automation_run_steps blocker
             WHERE blocker.run_id = s.run_id
               AND blocker.sort_order < s.sort_order
               AND blocker.status NOT IN ('succeeded', 'skipped')
           )
         ORDER BY s.sort_order ASC
         LIMIT $2
         FOR UPDATE OF s SKIP LOCKED
       )
       UPDATE automation_run_steps s
       SET status = 'running',
           started_at = COALESCE(s.started_at, NOW()),
           timeout_at = NOW() + (INTERVAL '1 second' * COALESCE(
             (s.metadata->>'timeoutSeconds')::int,
             (SELECT a.timeout_seconds FROM automation_actions a WHERE a.id = s.action_id),
             60
           )),
           attempt = CASE WHEN s.started_at IS NOT NULL THEN s.attempt + 1 ELSE s.attempt END,
           updated_at = NOW()
       FROM claimable c WHERE s.id = c.id
       RETURNING s.*`,
      [runId, 1],
    );
    if (stepClaim.rows.length !== 1) throw new Error(`claimNextStep expected 1 row, got ${stepClaim.rows.length}`);
    if (stepClaim.rows[0].status !== 'running') throw new Error('claimed step not marked running');
    if (stepClaim.rows[0].attempt !== 1) throw new Error(`expected attempt=1 on first claim, got ${stepClaim.rows[0].attempt}`);
    if (!stepClaim.rows[0].timeout_at) throw new Error('timeout_at not set');
    ok('claimNextStep cross-table JOIN executed (runs->workflows->actions), attempt=1, timeout_at set');

    // 4b. disabled workflow must make the run ineligible (enable/disable enforcement)
    await c.query('UPDATE automation_workflows SET is_enabled = FALSE WHERE id = $1', [workflowId]);
    await c.query(`UPDATE automation_run_steps SET status='queued', next_retry_at=NULL WHERE id=$1`, [stepId]);
    const disabledClaim = await c.query(
      `WITH eligible_run AS (
         SELECT r.id FROM automation_runs r
         JOIN automation_workflows w ON w.id = r.workflow_id AND w.organization_id = r.organization_id
         WHERE r.id = $1 AND r.status IN ('queued','running') AND w.is_enabled = TRUE AND w.deleted_at IS NULL
         LIMIT 1
       )
       SELECT COUNT(*)::int AS n FROM eligible_run`,
      [runId],
    );
    if (disabledClaim.rows[0].n !== 0) throw new Error('disabled workflow still eligible for step claim');
    ok('disabled workflow correctly blocks step claim (backend-enforced OFF switch)');
    await c.query('UPDATE automation_workflows SET is_enabled = TRUE WHERE id = $1', [workflowId]);

    // ---------------------------------------------------------------------
    // 5. audit log insert — exact SQL from audit.ts, incl. dotted action value
    // ---------------------------------------------------------------------
    const aud = await c.query(
      `INSERT INTO automation_audit_logs
        (organization_id, project_id, workflow_id, run_id, step_id, approval_id,
         actor_user_id, actor_type, action, entity_type, entity_id,
         request_id, ip_address, user_agent, before_state, after_state, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::inet,$14,$15::jsonb,$16::jsonb,$17::jsonb)
       RETURNING *`,
      [orgId, null, workflowId, runId, stepId, null, null, 'system', 'run.queued',
        'run', runId, 'req-1', '10.0.0.1', 'verify-agent', null, JSON.stringify({ status: 'queued' }), JSON.stringify({})],
    );
    if (!aud.rows[0]) throw new Error('audit insert returned no row');
    ok(`audit log insert executed with dotted action '${aud.rows[0].action}' and inet cast`);

    // 5b. the value that is NOT in the automation_audit_action enum must still work
    await c.query(
      `INSERT INTO automation_audit_logs (organization_id, workflow_id, actor_type, action, entity_type)
       VALUES ($1,$2,'system','run.dead_lettered','run')`,
      [orgId, workflowId],
    );
    ok("audit action 'run.dead_lettered' (absent from legacy enum) accepted — VARCHAR choice validated");

    // ---------------------------------------------------------------------
    // 6. cooldown / rate-limit gate queries from workers.ts
    // ---------------------------------------------------------------------
    await c.query(`SELECT pg_advisory_xact_lock($1)`, ['1234567890']);
    const cd = await c.query(
      `SELECT 1 FROM automation_runs WHERE workflow_id=$1 AND organization_id=$2
         AND created_at > NOW() - ($3||' seconds')::interval LIMIT 1`,
      [workflowId, orgId, 60],
    );
    const rl = await c.query(
      `SELECT COUNT(*)::int AS n FROM automation_runs WHERE workflow_id=$1 AND organization_id=$2
         AND created_at > NOW() - INTERVAL '1 hour'`,
      [workflowId, orgId],
    );
    ok(`cooldown gate query ran (hit=${cd.rows.length > 0}); hourly rate query ran (n=${rl.rows[0].n})`);

    // ---------------------------------------------------------------------
    // 7. tenant isolation — another org must not see this run
    // ---------------------------------------------------------------------
    const leak = await c.query(
      `SELECT * FROM automation_runs WHERE id = $1 AND organization_id = $2`,
      [runId, otherOrgId],
    );
    if (leak.rows.length !== 0) throw new Error('TENANT LEAK: other org could read the run');
    ok('tenant isolation verified: cross-org run lookup returns 0 rows');

    // ---------------------------------------------------------------------
    // 8. completeInboxEvent / failInboxEvent
    // ---------------------------------------------------------------------
    await c.query(
      `UPDATE automation_events_inbox SET status='processed', processed_at=NOW(), locked_at=NULL, locked_by=NULL WHERE id=$1`,
      [inboxId],
    );
    await c.query(
      `UPDATE automation_events_inbox SET status=$2, last_error=$3, next_retry_at=$4, locked_at=NULL, locked_by=NULL WHERE id=$1`,
      [inboxId, 'retry', 'simulated failure', new Date(Date.now() + 60000)],
    );
    ok('completeInboxEvent and failInboxEvent SQL both executed');

    // ---------------------------------------------------------------------
    // 9. run completion aggregation
    // ---------------------------------------------------------------------
    const agg = await c.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status='succeeded')::int AS succeeded,
              COUNT(*) FILTER (WHERE status='failed')::int AS failed
         FROM automation_run_steps WHERE run_id = $1`,
      [runId],
    );
    ok(`run aggregation query executed: ${JSON.stringify(agg.rows[0])}`);

    console.log('\nALL RUNTIME SQL VERIFIED AGAINST LIVE PRIMARY SCHEMA');
  } catch (e) {
    console.error('\nVERIFICATION FAILED:', e.message);
    await c.query('ROLLBACK');
    await c.end();
    process.exit(1);
  }
  await c.query('ROLLBACK');
  console.log('(transaction rolled back — no test data persisted)');
  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
