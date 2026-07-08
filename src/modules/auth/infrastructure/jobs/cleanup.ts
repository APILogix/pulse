/**
 * Auth automation / housekeeping logic.
 *
 * The auth email outbox is intentionally queue-only. This cleanup pass keeps
 * the durable table bounded by purging already-processed rows on a daily
 * schedule. Sent rows are retained briefly for operational visibility; failed
 * rows are retained longer for debugging and incident review.
 */
import type { FastifyBaseLogger } from 'fastify';

import {
  purgeFailedAuthEmailOutbox,
  purgeSentAuthEmailOutbox,
} from '../email/email-outbox.js';

export const AUTH_AUTOMATION_RETENTION = {
  sentEmailDays: 14,
  failedEmailDays: 30,
} as const;

export interface DailyAuthAutomationResult {
  sentEmailsPurged: number;
  failedEmailsPurged: number;
  durationMs: number;
}

export async function runDailyAuthAutomation(
  log: FastifyBaseLogger,
): Promise<DailyAuthAutomationResult> {
  const start = Date.now();
  const result: DailyAuthAutomationResult = {
    sentEmailsPurged: 0,
    failedEmailsPurged: 0,
    durationMs: 0,
  };

  try {
    result.sentEmailsPurged = await purgeSentAuthEmailOutbox(
      AUTH_AUTOMATION_RETENTION.sentEmailDays,
    );
  } catch (err) {
    log.error({ err }, 'auth automation: purgeSentAuthEmailOutbox failed');
  }

  try {
    result.failedEmailsPurged = await purgeFailedAuthEmailOutbox(
      AUTH_AUTOMATION_RETENTION.failedEmailDays,
    );
  } catch (err) {
    log.error({ err }, 'auth automation: purgeFailedAuthEmailOutbox failed');
  }

  result.durationMs = Date.now() - start;
  log.info(result, 'auth automation: daily pass complete');
  return result;
}
