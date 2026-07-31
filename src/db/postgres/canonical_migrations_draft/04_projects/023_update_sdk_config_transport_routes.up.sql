BEGIN;

-- Intentionally empty. The breaking schema-v1 upgrade in migration 025
-- recompiles every historical revision from allowlisted editable intent,
-- derives all /api/v1/* route URLs, and regenerates the canonical hash.
-- Keeping an intermediate snapshot rewriter here would create a second SDK
-- compiler and a second complete-document persistence path.

COMMIT;
