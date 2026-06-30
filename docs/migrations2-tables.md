# Migrations2 - Complete Database Schema

This document provides a comprehensive reference of all PostgreSQL tables created in the `migrations2/` folder, which represents the canonical, consolidated schema for the Pulse platform.

---

## Migration Files

| File | Purpose |
|------|---------|
| `001_auth_canonical_consolidated.up.sql` | Full auth schema with users, sessions, MFA, SSO, email tokens |
| `002_add_notification_connectors.up.sql` | Notification connector configurations |
| `003_add_alerting_module.up.sql` | Alerting rules, incidents, and notification channels |
| `004_add_analytics_module.up.sql` | Pulse SDK events and analytics tables |
| `005_add_mfa_system.up.sql` | Google-style MFA enhancements (display_hint, policy columns, SMS OTP) |

---

## Table Summary

| Schema | Table | Migration | Description |
|--------|-------|-----------|-------------|
| Auth | `users` | 001 | User accounts |
| Auth | `user_sessions` | 001 | Refresh token sessions |
| Auth | `user_mfa_devices` | 001 | MFA device enrollments |
| Auth | `email_mfa_otps` | 001 | Email OTP codes |
| Auth | `user_trusted_devices` | 001 | Remembered devices |
| Auth | `email_tokens` | 001 | Email verification tokens |
| Auth | `password_reset_tokens` | 001 | Password reset tokens |
| Auth | `account_unlock_tokens` | 001 | Account unlock tokens |
| Auth | `social_identities` | 001 | OAuth social login connections |
| Auth | `saml_identities` | 001 | SAML SSO identities |
| Auth | `sso_sessions` | 001 | SSO session tracking |
| Auth | `sms_mfa_otps` | 005 | SMS OTP codes |
| Connectors | `notification_connectors` | 002 | Notification connector configs |
| Connectors | `notification_connector_events` | 002 | Connector event log |
| Alerting | `alert_rules` | 003 | Alert rule definitions |
| Alerting | `alert_incidents` | 003 | Alert incident records |
| Alerting | `alert_notification_channels` | 003 | Notification channel configs |
| Alerting | `alert_rule_channels` | 003 | Rule-to-channel mappings |
| Analytics | `sdk_events` | 004 | Raw SDK ingestion events |
| Analytics | `sdk_event_aggregates` | 004 | Pre-aggregated event metrics |
| Analytics | `sdk_event_sessions` | 004 | User session tracking |
| Legacy (referenced) | `organizations` | migrations/010 | Organization entities |
| Legacy (referenced) | `organization_members` | migrations/010 | Org memberships |
| Legacy (referenced) | `organization_settings` | migrations/010 + 005 | Org policy settings |
| Legacy (referenced) | `audit_logs` | migrations/002 | Audit log entries |

---

## Detailed Table Definitions

---

### 001_auth_canonical_consolidated.up.sql

#### `users`

Primary user accounts table.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `email` | VARCHAR(255) | NO | - | User email (unique) |
| `password_hash` | VARCHAR(255) | YES | - | Bcrypt password hash |
| `name` | VARCHAR(255) | YES | - | Display name |
| `email_verified` | BOOLEAN | NO | `FALSE` | Email verification status |
| `mfa_enabled` | BOOLEAN | NO | `FALSE` | MFA enrollment status |
| `is_admin` | BOOLEAN | NO | `FALSE` | Platform admin flag |
| `status` | VARCHAR(20) | NO | `'active'` | Account status: active, suspended, locked |
| `login_attempts` | INTEGER | NO | `0` | Failed login counter |
| `locked_until` | TIMESTAMPTZ | YES | - | Account lockout expiry |
| `last_login_at` | TIMESTAMPTZ | YES | - | Last successful login |
| `last_login_ip` | INET | YES | - | Last login IP address |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NO | `NOW()` | Last update timestamp |

**Indexes:**
- `users_email_unique` UNIQUE on `email`
- `idx_users_status` on `status`

**Constraints:**
- `status` CHECK IN ('active', 'suspended', 'locked', 'deleted')

---

#### `user_sessions`

Refresh token sessions with rotation tracking.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `user_id` | UUID | NO | - | FK to `users.id` |
| `token_hash` | VARCHAR(255) | NO | - | Hashed refresh token |
| `user_agent` | TEXT | YES | - | Browser user agent |
| `ip_address` | INET | YES | - | Session IP address |
| `expires_at` | TIMESTAMPTZ | NO | - | Session expiry |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |
| `revoked_at` | TIMESTAMPTZ | YES | - | Revocation timestamp |
| `replaced_by` | UUID | YES | - | New session ID (rotation) |

**Indexes:**
- `idx_user_sessions_token` UNIQUE on `token_hash`
- `idx_user_sessions_user` on `user_id`
- `idx_user_sessions_expires` on `expires_at` WHERE `revoked_at` IS NULL

---

#### `user_mfa_devices`

MFA device enrollments (TOTP, email, hardware keys, backup codes).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `user_id` | UUID | NO | - | FK to `users.id` |
| `device_type` | VARCHAR(50) | NO | - | Type: totp, email, hardware_key, backup_codes, sms |
| `device_name` | VARCHAR(255) | NO | - | User-friendly name |
| `secret_encrypted` | TEXT | YES | - | AES-256-GCM encrypted TOTP secret |
| `backup_codes_hash` | JSONB | YES | - | SHA-256 hashed backup codes |
| `credential_id` | TEXT | YES | - | WebAuthn credential ID |
| `public_key` | TEXT | YES | - | WebAuthn public key |
| `sign_count` | INTEGER | YES | - | WebAuthn signature counter |
| `aaguid` | UUID | YES | - | Authenticator AAGUID |
| `is_primary` | BOOLEAN | NO | `FALSE` | Primary device flag |
| `is_active` | BOOLEAN | NO | `TRUE` | Active status |
| `verified` | BOOLEAN | NO | `FALSE` | Setup verified flag |
| `device_metadata` | JSONB | YES | `{}` | Additional device info |
| `last_used_at` | TIMESTAMPTZ | YES | - | Last verification time |
| `last_used_ip` | INET | YES | - | Last verification IP |
| `display_hint` | VARCHAR(255) | YES | - | Masked hint for "try another way" (migration 005) |
| `phone_number_encrypted` | TEXT | YES | - | Encrypted SMS destination (migration 005) |
| `failed_attempts` | INTEGER | NO | `0` | Per-device failed attempts (migration 005) |
| `last_failed_at` | TIMESTAMPTZ | YES | - | Last failed attempt (migration 005) |
| `use_count` | INTEGER | NO | `0` | Total successful verifications (migration 005) |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NO | `NOW()` | Last update timestamp |
| `created_by` | UUID | YES | - | User who created (audit) |

**Indexes:**
- `idx_mfa_devices_user` on `user_id, is_active, verified`
- `idx_mfa_devices_primary` on `user_id` WHERE `is_primary = TRUE`

**Constraints:**
- `device_type` CHECK IN ('totp', 'email', 'hardware_key', 'backup_codes', 'sms')
- `mfa_device_name_unique_per_user` UNIQUE (`user_id`, `name`)
- `mfa_device_one_primary_per_user` UNIQUE (`user_id`) WHERE `is_primary = TRUE`

---

#### `email_mfa_otps`

Email one-time passwords for MFA.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `user_id` | UUID | NO | - | FK to `users.id` |
| `device_id` | UUID | NO | - | FK to `user_mfa_devices.id` |
| `code_hash` | VARCHAR(64) | NO | - | SHA-256 hash of code |
| `expires_at` | TIMESTAMPTZ | NO | - | Code expiry time |
| `used_at` | TIMESTAMPTZ | YES | - | When code was used |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |

**Indexes:**
- `idx_email_mfa_otps_active_device` UNIQUE on `device_id` WHERE `used_at` IS NULL
- `idx_email_mfa_otps_user` on `user_id, created_at DESC`

---

#### `sms_mfa_otps` (Migration 005)

SMS one-time passwords for MFA (mirrors `email_mfa_otps`).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `user_id` | UUID | NO | - | FK to `users.id` |
| `device_id` | UUID | NO | - | FK to `user_mfa_devices.id` |
| `code_hash` | VARCHAR(64) | NO | - | SHA-256 hash of code |
| `expires_at` | TIMESTAMPTZ | NO | - | Code expiry time |
| `used_at` | TIMESTAMPTZ | YES | - | When code was used |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |

**Indexes:**
- `idx_sms_mfa_otps_active_device` UNIQUE on `device_id` WHERE `used_at` IS NULL
- `idx_sms_mfa_otps_user` on `user_id, created_at DESC`
- `idx_sms_mfa_otps_cleanup` on `expires_at` WHERE `used_at` IS NULL

---

#### `user_trusted_devices`

Remembered devices for MFA skip.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `user_id` | UUID | NO | - | FK to `users.id` |
| `device_fingerprint` | VARCHAR(255) | NO | - | Device identifier hash |
| `device_name` | VARCHAR(255) | YES | - | User-friendly device name |
| `expires_at` | TIMESTAMPTZ | NO | - | Trust expiry |
| `ip_address` | INET | YES | - | IP when trusted |
| `user_agent` | TEXT | YES | - | User agent when trusted |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |

**Indexes:**
- `idx_trusted_devices_user` on `user_id, expires_at`
- `trusted_device_unique` UNIQUE (`user_id`, `device_fingerprint`)

---

#### `email_tokens`

Email verification and magic link tokens.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `user_id` | UUID | NO | - | FK to `users.id` |
| `token_hash` | VARCHAR(64) | NO | - | SHA-256 token hash |
| `type` | VARCHAR(50) | NO | - | Token purpose |
| `expires_at` | TIMESTAMPTZ | NO | - | Token expiry |
| `used_at` | TIMESTAMPTZ | YES | - | When used |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |

**Token Types:** `email_verification`, `magic_link`, `email_change_verification`

**Indexes:**
- `idx_email_tokens_hash` UNIQUE on `token_hash`
- `idx_email_tokens_user` on `user_id, type, created_at DESC`

---

#### `password_reset_tokens`

Password reset tokens.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `user_id` | UUID | NO | - | FK to `users.id` |
| `token_hash` | VARCHAR(64) | NO | - | SHA-256 token hash |
| `expires_at` | TIMESTAMPTZ | NO | - | Token expiry |
| `used_at` | TIMESTAMPTZ | YES | - | When used |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |

**Indexes:**
- `idx_password_reset_tokens_hash` UNIQUE on `token_hash`
- `idx_password_reset_tokens_user` on `user_id, created_at DESC`

---

#### `account_unlock_tokens`

Account unlock tokens.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `user_id` | UUID | NO | - | FK to `users.id` |
| `token_hash` | VARCHAR(64) | NO | - | SHA-256 token hash |
| `expires_at` | TIMESTAMPTZ | NO | - | Token expiry |
| `used_at` | TIMESTAMPTZ | YES | - | When used |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |

---

#### `social_identities`

OAuth/social login connections.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `user_id` | UUID | NO | - | FK to `users.id` |
| `provider` | VARCHAR(50) | NO | - | OAuth provider name |
| `provider_user_id` | VARCHAR(255) | NO | - | Provider's user ID |
| `access_token_encrypted` | TEXT | YES | - | Encrypted OAuth token |
| `refresh_token_encrypted` | TEXT | YES | - | Encrypted refresh token |
| `token_expires_at` | TIMESTAMPTZ | YES | - | Token expiry |
| `profile_data` | JSONB | YES | - | Raw profile from provider |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NO | `NOW()` | Last update timestamp |

**Indexes:**
- `idx_social_identities_provider` UNIQUE on `provider, provider_user_id`
- `idx_social_identities_user` on `user_id`

---

#### `saml_identities`

SAML SSO identity connections.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `user_id` | UUID | NO | - | FK to `users.id` |
| `idp_entity_id` | VARCHAR(255) | NO | - | SAML IdP entity ID |
| `name_id` | VARCHAR(255) | NO | - | SAML NameID |
| `session_index` | VARCHAR(255) | YES | - | SAML session index |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NO | `NOW()` | Last update timestamp |

---

#### `sso_sessions`

SSO session tracking.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `user_id` | UUID | NO | - | FK to `users.id` |
| `idp_entity_id` | VARCHAR(255) | NO | - | SAML IdP entity ID |
| `session_index` | VARCHAR(255) | YES | - | SAML session index |
| `expires_at` | TIMESTAMPTZ | NO | - | Session expiry |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |

---

### 002_add_notification_connectors.up.sql

#### `notification_connectors`

Notification connector configurations (Slack, Discord, Email, PagerDuty, etc.).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `org_id` | UUID | YES | - | FK to `organizations.id` (null = global) |
| `name` | VARCHAR(255) | NO | - | Connector display name |
| `type` | VARCHAR(50) | NO | - | Connector type: slack, discord, email, pagerduty, webhook |
| `config_encrypted` | TEXT | NO | - | AES-256-GCM encrypted config JSON |
| `is_active` | BOOLEAN | NO | `TRUE` | Active status |
| `created_by` | UUID | YES | - | FK to `users.id` |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NO | `NOW()` | Last update timestamp |

**Connector Types:** `slack`, `discord`, `email`, `pagerduty`, `webhook`, `twilio`, `sendgrid`

**Indexes:**
- `idx_notification_connectors_org` on `org_id`
- `idx_notification_connectors_type` on `type`

---

#### `notification_connector_events`

Event log for connector invocations.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `connector_id` | UUID | NO | - | FK to `notification_connectors.id` |
| `event_type` | VARCHAR(100) | NO | - | Event type (alert, notification, etc.) |
| `payload` | JSONB | NO | - | Event payload |
| `response_status` | INTEGER | YES | - | HTTP response status |
| `response_body` | TEXT | YES | - | Response body (truncated) |
| `error_message` | TEXT | YES | - | Error message if failed |
| `duration_ms` | INTEGER | YES | - | Request duration |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |

**Indexes:**
- `idx_connector_events_connector` on `connector_id, created_at DESC`
- `idx_connector_events_status` on `response_status` WHERE `response_status >= 400`

---

### 003_add_alerting_module.up.sql

#### `alert_rules`

Alert rule definitions.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `org_id` | UUID | NO | - | FK to `organizations.id` |
| `project_id` | UUID | YES | - | FK to `projects.id` (null = org-level) |
| `name` | VARCHAR(255) | NO | - | Rule name |
| `description` | TEXT | YES | - | Rule description |
| `condition_type` | VARCHAR(50) | NO | - | Condition: threshold, anomaly, composite |
| `condition_config` | JSONB | NO | - | Condition configuration |
| `severity` | VARCHAR(20) | NO | - | Severity: critical, high, medium, low |
| `enabled` | BOOLEAN | NO | `TRUE` | Enabled status |
| `cooldown_seconds` | INTEGER | NO | `300` | Minimum time between alerts |
| `created_by` | UUID | YES | - | FK to `users.id` |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NO | `NOW()` | Last update timestamp |

**Condition Types:** `threshold`, `anomaly`, `composite`, `missing_data`

**Severities:** `critical`, `high`, `medium`, `low`, `info`

**Indexes:**
- `idx_alert_rules_org` on `org_id`
- `idx_alert_rules_project` on `project_id`
- `idx_alert_rules_enabled` on `enabled`

---

#### `alert_incidents`

Alert incident records.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `rule_id` | UUID | NO | - | FK to `alert_rules.id` |
| `org_id` | UUID | NO | - | FK to `organizations.id` |
| `status` | VARCHAR(20) | NO | - | Status: firing, resolved, acknowledged, silenced |
| `severity` | VARCHAR(20) | NO | - | Incident severity |
| `message` | TEXT | NO | - | Incident message |
| `labels` | JSONB | NO | `{}` | Incident labels |
| `annotations` | JSONB | NO | `{}` | Incident annotations |
| `fired_at` | TIMESTAMPTZ | NO | `NOW()` | When incident fired |
| `resolved_at` | TIMESTAMPTZ | YES | - | When resolved |
| `acknowledged_at` | TIMESTAMPTZ | YES | - | When acknowledged |
| `acknowledged_by` | UUID | YES | - | FK to `users.id` |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NO | `NOW()` | Last update timestamp |

**Statuses:** `firing`, `resolved`, `acknowledged`, `silenced`

**Indexes:**
- `idx_alert_incidents_rule` on `rule_id`
- `idx_alert_incidents_org` on `org_id, created_at DESC`
- `idx_alert_incidents_status` on `status`

---

#### `alert_notification_channels`

Notification channel configurations.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `org_id` | UUID | NO | - | FK to `organizations.id` |
| `name` | VARCHAR(255) | NO | - | Channel name |
| `type` | VARCHAR(50) | NO | - | Channel type |
| `config_encrypted` | TEXT | NO | - | Encrypted channel config |
| `is_default` | BOOLEAN | NO | `FALSE` | Default channel for org |
| `created_by` | UUID | YES | - | FK to `users.id` |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NO | `NOW()` | Last update timestamp |

**Channel Types:** `slack`, `discord`, `email`, `pagerduty`, `webhook`, `opsgenie`

**Indexes:**
- `idx_alert_channels_org` on `org_id`

---

#### `alert_rule_channels`

Many-to-many mapping between rules and channels.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `rule_id` | UUID | NO | - | FK to `alert_rules.id` |
| `channel_id` | UUID | NO | - | FK to `alert_notification_channels.id` |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |

**Constraints:**
- PRIMARY KEY (`rule_id`, `channel_id`)

---

### 004_add_analytics_module.up.sql

#### `sdk_events`

Raw SDK ingestion events (time-series optimized).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `org_id` | UUID | NO | - | FK to `organizations.id` |
| `project_id` | UUID | YES | - | FK to `projects.id` |
| `event_type` | VARCHAR(100) | NO | - | Event type |
| `event_name` | VARCHAR(255) | NO | - | Event name |
| `user_id` | VARCHAR(255) | YES | - | External user ID |
| `session_id` | VARCHAR(255) | YES | - | Session ID |
| `properties` | JSONB | NO | `{}` | Event properties |
| `context` | JSONB | NO | `{}` | Event context (IP, UA, etc.) |
| `timestamp` | TIMESTAMPTZ | NO | - | Event timestamp |
| `received_at` | TIMESTAMPTZ | NO | `NOW()` | Ingestion timestamp |

**Indexes:**
- `idx_sdk_events_org_time` on `org_id, timestamp DESC`
- `idx_sdk_events_project_time` on `project_id, timestamp DESC`
- `idx_sdk_events_type` on `event_type`
- `idx_sdk_events_user` on `user_id`
- `idx_sdk_events_session` on `session_id`

---

#### `sdk_event_aggregates`

Pre-aggregated event metrics for dashboard queries.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `org_id` | UUID | NO | - | FK to `organizations.id` |
| `project_id` | UUID | YES | - | FK to `projects.id` |
| `event_type` | VARCHAR(100) | NO | - | Event type |
| `event_name` | VARCHAR(255) | NO | - | Event name |
| `time_bucket` | TIMESTAMPTZ | NO | - | Hourly/Daily bucket |
| `bucket_size` | VARCHAR(20) | NO | - | Bucket size: hour, day |
| `event_count` | BIGINT | NO | `0` | Event count |
| `unique_users` | BIGINT | NO | `0` | Unique user count |
| `unique_sessions` | BIGINT | NO | `0` | Unique session count |
| `property_summaries` | JSONB | NO | `{}` | Aggregated property stats |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NO | `NOW()` | Last update timestamp |

**Indexes:**
- `idx_sdk_aggregates_org_bucket` UNIQUE on `org_id, event_type, event_name, time_bucket, bucket_size`
- `idx_sdk_aggregates_project` on `project_id`

---

#### `sdk_event_sessions`

User session tracking.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | `gen_random_uuid()` | Primary key |
| `org_id` | UUID | NO | - | FK to `organizations.id` |
| `project_id` | UUID | YES | - | FK to `projects.id` |
| `session_id` | VARCHAR(255) | NO | - | Session ID |
| `user_id` | VARCHAR(255) | YES | - | External user ID |
| `started_at` | TIMESTAMPTZ | NO | - | Session start |
| `ended_at` | TIMESTAMPTZ | YES | - | Session end |
| `duration_seconds` | INTEGER | YES | - | Session duration |
| `event_count` | INTEGER | NO | `0` | Events in session |
| `page_views` | INTEGER | NO | `0` | Page view count |
| `device_info` | JSONB | NO | `{}` | Device information |
| `geo_info` | JSONB | NO | `{}` | Geolocation info |
| `created_at` | TIMESTAMPTZ | NO | `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NO | `NOW()` | Last update timestamp |

**Indexes:**
- `idx_sdk_sessions_org` on `org_id, started_at DESC`
- `idx_sdk_sessions_session` UNIQUE on `session_id`
- `idx_sdk_sessions_user` on `user_id`

---

### 005_add_mfa_system.up.sql

This migration **adds columns** to existing tables rather than creating new ones (except `sms_mfa_otps`).

#### Changes to `user_mfa_devices`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `display_hint` | VARCHAR(255) | YES | - | Masked hint for "try another way" UI |
| `phone_number_encrypted` | TEXT | YES | - | Encrypted phone number for SMS |
| `failed_attempts` | INTEGER | NO | `0` | Per-device failed attempt counter |
| `last_failed_at` | TIMESTAMPTZ | YES | - | Timestamp of last failed attempt |
| `use_count` | INTEGER | NO | `0` | Total successful verifications |

**New Index:**
- `idx_mfa_devices_failed` on `failed_attempts` WHERE `failed_attempts > 0`

---

#### Changes to `organization_settings`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `mfa_allowed_methods` | TEXT[] | NO | `ARRAY['totp','email','sms','backup_codes']` | Permitted MFA methods |
| `mfa_primary_method_preference` | VARCHAR(50) | YES | - | Preferred primary MFA method |
| `mfa_backup_codes_required` | BOOLEAN | NO | `FALSE` | Require backup codes on enrollment |
| `mfa_grace_period_days` | INTEGER | NO | `0` | Days before MFA enforcement |
| `mfa_max_devices_per_user` | INTEGER | NO | `10` | Device cap per user |
| `mfa_allow_sms_fallback` | BOOLEAN | NO | `TRUE` | Allow SMS as fallback |
| `mfa_allow_email_fallback` | BOOLEAN | NO | `TRUE` | Allow email as fallback |
| `mfa_remember_device_days` | INTEGER | NO | `30` | Days to trust a device |

---

## Entity Relationships

```
users
  ├── user_sessions (1:N)
  ├── user_mfa_devices (1:N)
  │     ├── email_mfa_otps (1:N)
  │     └── sms_mfa_otps (1:N)
  ├── user_trusted_devices (1:N)
  ├── email_tokens (1:N)
  ├── password_reset_tokens (1:N)
  ├── account_unlock_tokens (1:N)
  ├── social_identities (1:N)
  ├── saml_identities (1:N)
  └── sso_sessions (1:N)

organizations
  ├── organization_members (1:N)
  ├── organization_settings (1:1)
  ├── projects (1:N)
  ├── notification_connectors (1:N)
  ├── alert_rules (1:N)
  ├── alert_incidents (1:N)
  ├── alert_notification_channels (1:N)
  └── sdk_events (1:N)

alert_rules
  ├── alert_incidents (1:N)
  └── alert_rule_channels (1:N)

alert_notification_channels
  └── alert_rule_channels (1:N)

notification_connectors
  └── notification_connector_events (1:N)

sdk_events
  └── sdk_event_aggregates (aggregated from)
```

---

## Migration Execution Order

To apply migrations2 from scratch:

```bash
# 1. Apply legacy migrations (if not already applied)
psql -d pulse_db -f migrations/001_users.sql
psql -d pulse_db -f migrations/002_audit_logs.sql
# ... continue through 010_organizations.sql, 011_projects.sql

# 2. Apply migrations2 (canonical, consolidated)
psql -d pulse_db -f migrations2/001_auth_canonical_consolidated.up.sql
psql -d pulse_db -f migrations2/002_add_notification_connectors.up.sql
psql -d pulse_db -f migrations2/003_add_alerting_module.up.sql
psql -d pulse_db -f migrations2/004_add_analytics_module.up.sql
psql -d pulse_db -f migrations2/005_add_mfa_system.up.sql
```

**Note:** Migration 001 will handle `IF NOT EXISTS` for tables that overlap with legacy migrations.

---

## Notes

1. **No Row-Level Security (RLS):** RLS is intentionally disabled. The codebase uses application-level isolation with `org_id` filtering. See migration 001 BUGFIX #4 note.

2. **Encryption:** All sensitive fields (secrets, tokens, phone numbers) are encrypted with AES-256-GCM before storage.

3. **Token Hashing:** All tokens (refresh, email, OTP, invitation) are stored as SHA-256 hashes, not plaintext.

4. **Soft Deletes:** Organizations and projects use `deleted_at` for soft deletes. Users use `status = 'deleted'`.

5. **Time-Series Optimization:** The `sdk_events` table is designed for time-series workloads and should be partitioned by `timestamp` for high-volume deployments.
