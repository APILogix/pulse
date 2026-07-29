BEGIN;

CREATE TABLE IF NOT EXISTS geo_countries (
  country_code CHAR(2) PRIMARY KEY,
  country_name TEXT NOT NULL,
  continent_code CHAR(2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS geo_networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cidr CIDR NOT NULL,
  country_code CHAR(2),
  region TEXT,
  city TEXT,
  asn INTEGER,
  isp TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cidr)
);
CREATE INDEX IF NOT EXISTS idx_geo_networks_cidr ON geo_networks(cidr);
CREATE INDEX IF NOT EXISTS idx_geo_networks_country ON geo_networks(country_code);

CREATE TABLE IF NOT EXISTS geo_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2),
  region TEXT,
  city TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  timezone TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (country_code, region, city)
);
CREATE INDEX IF NOT EXISTS idx_geo_locations_country_region ON geo_locations(country_code, region);

COMMIT;
