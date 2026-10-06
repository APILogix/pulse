-- Source: canonical_migrations_draft/17_enterprise_ingestion/004_plans_seed.up.sql
INSERT INTO plans (key, version, name, tier, description, trial_days, is_active, is_public, sort_order)
VALUES
  ('free',       1, 'Free',       'free',       'Community tier with shared ingestion capacity.', 0,  TRUE, TRUE, 10),
  ('starter',    1, 'Starter',    'starter',    'Entry paid tier for small teams.',               14, TRUE, TRUE, 20),
  ('growth',     1, 'Growth',     'growth',     'Scaling teams with higher event volumes.',       14, TRUE, TRUE, 30),
  ('business',   1, 'Business',   'business',   'Production workloads with priority ingestion.',  14, TRUE, TRUE, 40),
  ('enterprise', 1, 'Enterprise', 'enterprise', 'Dedicated capacity and highest ingestion priority.', 0, TRUE, TRUE, 50)
ON CONFLICT ON CONSTRAINT uq_plans_key_version DO NOTHING;
