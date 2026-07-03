CREATE INDEX IF NOT EXISTS idx_linked_identities_provider_subject_active
ON user_linked_identities(provider, provider_subject)
WHERE revoked_at IS NULL;