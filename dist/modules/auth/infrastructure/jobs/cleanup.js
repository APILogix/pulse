import { purgeFailedAuthEmailOutbox, purgeSentAuthEmailOutbox, } from '../email/email-outbox.js';
export const AUTH_AUTOMATION_RETENTION = {
    sentEmailDays: 14,
    failedEmailDays: 30,
};
export async function runDailyAuthAutomation(log) {
    const start = Date.now();
    const result = {
        sentEmailsPurged: 0,
        failedEmailsPurged: 0,
        durationMs: 0,
    };
    try {
        result.sentEmailsPurged = await purgeSentAuthEmailOutbox(AUTH_AUTOMATION_RETENTION.sentEmailDays);
    }
    catch (err) {
        log.error({ err }, 'auth automation: purgeSentAuthEmailOutbox failed');
    }
    try {
        result.failedEmailsPurged = await purgeFailedAuthEmailOutbox(AUTH_AUTOMATION_RETENTION.failedEmailDays);
    }
    catch (err) {
        log.error({ err }, 'auth automation: purgeFailedAuthEmailOutbox failed');
    }
    result.durationMs = Date.now() - start;
    log.info(result, 'auth automation: daily pass complete');
    return result;
}
//# sourceMappingURL=cleanup.js.map