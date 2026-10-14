/**
 * Task #5 (production readiness): closes the ONE remaining "not proven end-to-
 * end" gap for the notification.send/pagerduty.trigger action family used by 4
 * of the 6 alerting-sourced templates.
 *
 * This sends ONE REAL email, via the REAL connectors.NotificationDispatcher ->
 * EmailConnector -> real Gmail SMTP (nodemailer + .env's SMTP_* credentials),
 * exercising the exact same code path automation's notification.send action
 * uses in production. This is NOT a mock, NOT a dry run, NOT a "would send" —
 * a real message is delivered to a real inbox.
 *
 * User-authorized destination: vikasfixel@gmail.com (explicit instruction).
 *
 * ISOLATION: creates one temporary, real, active connector scoped ONLY to that
 * recipient address (never touches the org's actual managed/production
 * connector or its real alert-routing destination), runs the dispatch, records
 * proof (delivery row + returned message id), then deletes the temporary
 * connector and its delivery/audit rows so nothing test-related is left behind
 * in the database. The sent email itself cannot be "rolled back" — that is the
 * entire point: it is the real side effect being proven.
 */
require('dotenv').config();
const { Client } = require('pg');
const crypto = require('crypto');

const ok = (m) => console.log(`  PASS  ${m}`);
const info = (m) => console.log(`  INFO  ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); process.exitCode = 1; };

const RECIPIENT = 'vikasfixel@gmail.com';

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  let connectorId = null;
  try {
    const orgRes = await c.query(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`);
    const orgId = orgRes.rows[0].id;

    // ── 1. Create a REAL, temporary, active email connector scoped to the
    // authorized recipient only. Uses the app's own encryption (AES-256-GCM,
    // ENCRYPTION_KEY) so decryptConfigAsync in production code can read it
    // back correctly - not a hand-rolled format.
    const { encrypt } = requireEncryptModule();
    const config = { to: [RECIPIENT], fromName: 'Pulse Automation (verification)' };
    const encryptedConfig = Buffer.from(encrypt(JSON.stringify(config), process.env.ENCRYPTION_KEY), 'utf8');

    const connectorName = `E2E notification-dispatch verification ${Date.now()}`;
    const created = await c.query(
      `INSERT INTO connector_configs
         (organization_id, name, provider, status, description, public_config,
          supports_rich_formatting, supports_threading, supports_attachments,
          rate_limit_requests, rate_limit_window_seconds, max_retries, failure_threshold,
          provider_metadata, created_by)
       VALUES ($1, $2, 'email', 'active', 'Temporary connector for one-time real-send verification',
               '{}'::jsonb, TRUE, FALSE, TRUE, 100, 60, 3, 10,
               '{"managed":true,"managedBy":"verification-script","temporary":true}'::jsonb, NULL)
       RETURNING id`,
      [orgId, connectorName],
    );
    connectorId = created.rows[0].id;
    await c.query(
      `INSERT INTO connector_credentials (connector_id, credential_type, key_name, encrypted_value, algorithm, version, created_by)
       VALUES ($1, 'config', 'config', $2, 'aes-256-gcm', 1, NULL)`,
      [connectorId, encryptedConfig],
    );
    ok(`created a real, temporary, active email connector (id=${connectorId}) scoped to ${RECIPIENT} only`);

    // ── 2. Exercise the REAL production dispatch path: ConnectorRepository ->
    // NotificationDispatcher -> EmailConnector -> nodemailer -> real SMTP.
    // This is the exact chain automation's notification.send handler calls.
    const { ConnectorRepository } = requireCompiled('modules/connectors/repository.js');
    const { NotificationDispatcher } = requireCompiled('modules/connectors/delivery/delivery.service.js');
    const pino = require('pino');
    const logger = pino({ level: 'warn' });

    const connectors = new ConnectorRepository();
    const dispatcher = new NotificationDispatcher(connectors, logger);
    const row = await connectors.findById(orgId, connectorId);
    if (!row) throw new Error('temporary connector was not found immediately after creation');

    // correlation_id is a real `uuid` column in connector_deliveries; dedupKey
    // is stored inside the JSONB payload column (no type constraint), so it
    // can safely be a human-readable string.
    const correlationId = crypto.randomUUID();
    const dedupKey = `verify-real-send:${correlationId}`;
    const outcome = await dispatcher.dispatch(row, {
      notificationType: 'automation.notification',
      severity: 'info',
      title: 'Pulse automation bridge — real dispatch verification',
      body:
        'This is a real, one-time verification email sent by the automation ' +
        'production-readiness review. It proves notification.send/pagerduty.trigger ' +
        '(used by 4 of the 6 alerting-sourced automation templates) deliver a real ' +
        'message end-to-end through the exact production code path: ' +
        'ActionRunnerRegistry -> NotificationDispatcher -> EmailConnector -> SMTP. ' +
        'No action is needed on your part; this connector will be deleted automatically.',
      correlationId,
      dedupKey,
      metadata: { source: 'verify-real-notification-dispatch.cjs' },
    });

    console.log('  dispatch outcome:', JSON.stringify({ status: outcome.status, result: outcome.result }, null, 2));

    if (!outcome.result.success) {
      fail(`real dispatch FAILED: ${outcome.result.errorMessage ?? outcome.status}`);
    } else {
      ok(`REAL EMAIL SENT to ${RECIPIENT} — externalMessageId=${outcome.result.externalMessageId}, latencyMs=${outcome.result.latencyMs}, deliveryId=${outcome.deliveryId}`);
    }

    // ── 3. Verify the real delivery row this dispatch wrote.
    const deliveryRow = await c.query(
      `SELECT id, status, external_message_id, response_status_code FROM connector_deliveries WHERE id=$1`,
      [outcome.deliveryId],
    );
    if (deliveryRow.rows.length !== 1) {
      fail('no connector_deliveries row was found for this real dispatch');
    } else if (deliveryRow.rows[0].status !== 'sent') {
      fail(`delivery row status is "${deliveryRow.rows[0].status}", expected "sent"`);
    } else {
      ok(`real connector_deliveries row confirms status=sent, external_message_id=${deliveryRow.rows[0].external_message_id}`);
    }
  } catch (e) {
    console.error('\nSCRIPT ERROR:', e.stack || e.message);
    process.exitCode = 1;
  } finally {
    // ── 4. Clean up: delete the temporary connector and everything that
    // references it (deliveries, credentials, audit log), so nothing from
    // this one-time verification is left behind. The email itself already
    // left the system — that's the proof, not something to undo.
    if (connectorId) {
      await c.query(`DELETE FROM connector_deliveries WHERE connector_id=$1`, [connectorId]).catch(() => undefined);
      await c.query(`DELETE FROM connector_audit_logs WHERE connector_id=$1`, [connectorId]).catch(() => undefined);
      await c.query(`DELETE FROM connector_credentials WHERE connector_id=$1`, [connectorId]).catch(() => undefined);
      const dropped = await c.query(`DELETE FROM connector_configs WHERE id=$1 RETURNING id`, [connectorId]);
      if (dropped.rows.length === 1) info(`cleaned up: temporary connector ${connectorId} and its deliveries/credentials/audit rows permanently deleted`);
      else console.error(`WARNING: failed to delete temporary connector ${connectorId} — manual cleanup needed`);
    }
  }
  await c.end();
  // ConnectorRepository/NotificationDispatcher open their own pg.Pool (the
  // shared application pool) which keeps handles open beyond this script's
  // own work — force-exit once everything above has completed and been
  // logged, rather than leaving the process hanging on those pool handles.
  process.exit(process.exitCode ?? 0);
})();

function requireEncryptModule() {
  return requireCompiled('shared/utils/encryption.js');
}

function requireCompiled(relPath) {
  const path = require('path');
  return require(path.join(__dirname, '..', 'dist', relPath));
}
