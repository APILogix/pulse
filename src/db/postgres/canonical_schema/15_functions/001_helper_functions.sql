-- Database Helper Functions & Trigger Routines
-- File: 15_functions/001_helper_functions.sql

-- 1. Generic updated_at timestamp trigger function
CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Increment usage counter function
CREATE OR REPLACE FUNCTION fn_increment_usage_counter(
  p_org_id UUID,
  p_proj_id UUID,
  p_metric_key VARCHAR,
  p_date_bucket DATE,
  p_increment BIGINT
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO usage_daily_counters (
    organization_id,
    project_id,
    metric_key,
    date_bucket,
    count_value,
    updated_at
  )
  VALUES (
    p_org_id,
    p_proj_id,
    p_metric_key,
    p_date_bucket,
    p_increment,
    NOW()
  )
  ON CONFLICT (organization_id, project_id, metric_key, date_bucket)
  DO UPDATE SET
    count_value = usage_daily_counters.count_value + EXCLUDED.count_value,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
