# API Key Prefix Policy

Public API keys expose only the runtime class:

- `pv_live_` is minted only for the Production environment.
- `pv_test_` is minted for every non-production environment, including development, local, staging, QA, preview, UAT, and sandbox.

The real environment remains authoritative in the database through the key's `project_api_keys.environment_id` mapping. Authorization and SDK configuration lookup must use that stored mapping, not text embedded in the API key.

## Backward Compatibility

Existing `pulsiv_*` keys remain authenticatable until they are rotated. They are matched by their stored `public_key` and verified by the stored `secret_hash`, exactly like new keys.

Do not rewrite existing key rows in place. The full secret is shown once and only its hash is stored, so a database migration cannot safely recreate a replacement secret. Rotation is the migration path:

1. Existing keys keep working.
2. Rotating or regenerating a key creates a new `pv_live_` or `pv_test_` key based on the stored environment.
3. Old environment-specific `pv_*` prefixes such as `pv_dev_`, `pv_staging_`, and `pv_qa_` are rejected.

## SDK Init Route

SDKs initialize with:

```http
POST /api/v1/init
Authorization: Bearer pv_test_<public>.<secret>
Content-Type: application/json

{}
```

The API key may also be sent as `X-API-Key` or as body field `apiKey`. After validation, the backend resolves organization, project, and environment from the stored key lookup and returns the full SDK config snapshot for that environment.

Expiry is optional. If `expiresAt` is omitted, `null`, or blank at creation time, the key never expires.
