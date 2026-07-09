import { describe, expect, it } from 'vitest';

import { loadBillingJobConfig } from '../../src/modules/billing/jobs/config.js';
import { BILLING_JOB_NAMES } from '../../src/modules/billing/jobs/types.js';

describe('billing jobs integration contract', () => {
  it('keeps schedules configured for all runtime job queues', () => {
    const config = loadBillingJobConfig();
    const configuredSchedules = Object.keys(config.schedules).length;
    const configuredJobs = Object.keys(BILLING_JOB_NAMES).length;

    expect(configuredSchedules).toBe(configuredJobs);
    expect(Object.values(config.schedules).every((schedule) => schedule.length > 0)).toBe(true);
  });
});
