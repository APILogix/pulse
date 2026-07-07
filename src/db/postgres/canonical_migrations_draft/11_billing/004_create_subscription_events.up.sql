BEGIN;

CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES organization_subscriptions(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL,
  old_plan_id UUID REFERENCES plans(id),
  new_plan_id UUID REFERENCES plans(id),
  actor VARCHAR(20) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_org_time
  ON subscription_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_events_sub_time
  ON subscription_events(subscription_id, created_at DESC);

COMMIT;
