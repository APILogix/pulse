BEGIN;

ALTER TYPE alert_state ADD VALUE IF NOT EXISTS 'healthy';
ALTER TYPE alert_state ADD VALUE IF NOT EXISTS 'triggered';
ALTER TYPE alert_state ADD VALUE IF NOT EXISTS 'escalated';
ALTER TYPE alert_state ADD VALUE IF NOT EXISTS 'closed';

COMMIT;
