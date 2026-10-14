/**
 * Centralized defaults for organization provisioning and regional settings.
 *
 * Current launch market is India (Asia/Kolkata).
 * Future international expansion only requires updating these centralized values.
 */
export const ORGANIZATION_DEFAULTS = {
  country: 'IN',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  locale: 'en-IN',
} as const;

export type OrganizationDefaults = typeof ORGANIZATION_DEFAULTS;
