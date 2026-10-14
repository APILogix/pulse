-- Network CIDR subnet lookup for IP intelligence and AS numbers
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

CREATE INDEX IF NOT EXISTS idx_geo_networks_country ON geo_networks(country_code);
