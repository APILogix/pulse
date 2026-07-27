BEGIN;

ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'paused';
ALTER TYPE project_member_role ADD VALUE IF NOT EXISTS 'qa';
ALTER TYPE api_key_status ADD VALUE IF NOT EXISTS 'suspended';
ALTER TYPE api_key_status ADD VALUE IF NOT EXISTS 'rotated';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_visibility') THEN
    CREATE TYPE project_visibility AS ENUM ('private', 'organization', 'public');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_member_status') THEN
    CREATE TYPE project_member_status AS ENUM ('pending', 'active', 'inactive', 'removed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_type') THEN
    CREATE TYPE api_key_type AS ENUM ('read_write', 'read_only', 'write_only', 'temporary');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_rotation_state') THEN
    CREATE TYPE api_key_rotation_state AS ENUM ('none', 'rotating', 'grace_period', 'completed');
  END IF;
END $$;

COMMIT;
