import { logger } from '../config/logger.js';
import { processAuthEmailOutbox } from '../modules/auth/infrastructure/email/email-outbox.js';

const workerLogger = logger.child({ component: 'auth-email-worker' });

let isRunning = false;
let timeoutId: NodeJS.Timeout | null = null;
const BATCH_SIZE = 50;
const POLL_INTERVAL_MS = 5000;

/**
 * Worker polling loop for auth_email_outbox.
 */
async function pollAuthEmailOutbox(): Promise<void> {
  if (!isRunning) return;
  
  try {
    const sent = await processAuthEmailOutbox(BATCH_SIZE);
    
    // If we hit the max batch size, there might be more emails waiting.
    // Loop immediately instead of waiting for the next tick.
    if (sent === BATCH_SIZE) {
      timeoutId = setTimeout(pollAuthEmailOutbox, 0);
      return;
    }
  } catch (error) {
    workerLogger.error({ err: error }, 'Error in auth email polling loop');
  }

  timeoutId = setTimeout(pollAuthEmailOutbox, POLL_INTERVAL_MS);
}

/**
 * Starts the auth email worker polling loop.
 */
export async function startAuthEmailWorker(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  workerLogger.info('Starting auth email polling worker...');
  
  // Kick off the initial poll
  pollAuthEmailOutbox();
}

/**
 * Stops the auth email worker polling loop cleanly.
 */
export function stopAuthEmailWorker(): void {
  if (!isRunning) return;
  isRunning = false;
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  workerLogger.info('Auth email polling worker stopped.');
}
