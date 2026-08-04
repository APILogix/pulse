BEGIN;

ALTER TABLE project_api_keys
  DROP CONSTRAINT IF EXISTS project_api_keys_public_key_format_check;

ALTER TABLE project_api_keys
  ADD CONSTRAINT project_api_keys_public_key_format_check CHECK (
    public_key ~ '^(pv_live_|pv_test_)[0-9a-f]{24}$'
    OR public_key ~ '^pulsiv_[A-Za-z0-9_-]+$'
  );

COMMENT ON CONSTRAINT project_api_keys_public_key_format_check ON project_api_keys IS
  'Public API keys expose only pv_live_/pv_test_ for new keys; legacy pulsiv_* keys remain valid until rotation.';

COMMIT;
