-- ISO country code reference and IP geolocation lookup
CREATE TABLE IF NOT EXISTS geo_countries (
  country_code CHAR(2) PRIMARY KEY,
  name TEXT NOT NULL,
  continent_code CHAR(2),
  is_eu BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
