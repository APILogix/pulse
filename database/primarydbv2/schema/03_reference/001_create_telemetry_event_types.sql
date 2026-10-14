CREATE TABLE IF NOT EXISTS telemetry_event_types (
  id SMALLSERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO telemetry_event_types(name)
VALUES ('__all__'), ('request'), ('error'), ('log'), ('metric'), ('span'), ('trace'), ('message'), ('profile'), ('replay'), ('cron_checkin')
ON CONFLICT (name) DO NOTHING;
