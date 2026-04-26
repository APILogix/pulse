-- New password users must verify their email before the flag is set true.
ALTER TABLE users
  ALTER COLUMN email_verified SET DEFAULT FALSE;
