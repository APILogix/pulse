BEGIN;

WITH addon_seed(addon_key, name, description, category, target_feature_key, amount_minor, unit_quantity, unit_label) AS (
  VALUES
    ('events_10m', '10M Event Pack', 'Additional monthly event capacity', 'capacity', 'quota.monthly_events', 4900::bigint, 10000000, 'events'),
    ('ai_credits_100k', '100K AI Credits', 'Additional monthly AI credit capacity', 'capacity', 'quota.ai_credits', 9900::bigint, 100000, 'credits'),
    ('extra_project', 'Extra Project', 'One additional project', 'capacity', 'quota.projects', 500::bigint, 1, 'projects'),
    ('extra_member', 'Extra Member', 'One additional organization member', 'capacity', 'quota.members', 1000::bigint, 1, 'members')
), inserted AS (
  INSERT INTO addons (key, name, description, category, target_feature_id, is_active, metadata)
  SELECT seed.addon_key, seed.name, seed.description, seed.category, feature.id, TRUE,
         jsonb_build_object('seededBy', 'canonical-billing')
  FROM addon_seed seed
  JOIN billing_features feature ON feature.feature_key = seed.target_feature_key AND feature.deleted_at IS NULL
  ON CONFLICT (key) DO UPDATE SET
    name = EXCLUDED.name, description = EXCLUDED.description,
    target_feature_id = EXCLUDED.target_feature_id, is_active = TRUE,
    updated_at = NOW()
  RETURNING id, key
)
INSERT INTO addon_prices (addon_id, provider, billing_interval, currency, amount_minor, pricing_model, unit_quantity, unit_label, is_default)
SELECT inserted.id, 'system', 'monthly', 'USD', seed.amount_minor, 'per_unit', seed.unit_quantity, seed.unit_label, TRUE
FROM inserted
JOIN addon_seed seed ON seed.addon_key = inserted.key
WHERE NOT EXISTS (
  SELECT 1 FROM addon_prices price
  WHERE price.addon_id = inserted.id
    AND price.provider = 'system'
    AND price.billing_interval = 'monthly'
    AND price.currency = 'USD'
    AND price.starts_at IS NULL
);

COMMIT;
