# Auth and Billing Route Documentation

This document lists the routes in:
- Auth module (`/auth`)
- Billing module (`/billing`)

## Auth Module Routes (`/auth`)

| Method | Route | What it does |
|---|---|---|
| `GET` | `/auth/health` | Health check for auth module. |
| `POST` | `/auth/login` | Logs in using email/password. Returns session tokens, or MFA challenge if MFA is enabled. |
| `POST` | `/auth/login/mfa` | Completes login using MFA challenge and returns session tokens. |
| `POST` | `/auth/password/forgot` | Starts password reset flow (creates reset request/token workflow). |
| `POST` | `/auth/password/reset` | Resets password using reset token and invalidates old sessions. |
| `POST` | `/auth/password/change` | Changes current user password (authenticated user). |
| `POST` | `/auth/users` | Creates a new user account from email/password input. |
| `GET` | `/auth/users/me` | Returns current authenticated user profile. |
| `PATCH` | `/auth/users/me` | Updates current authenticated user profile fields. |
| `DELETE` | `/auth/users/me` | Soft-deletes current user account and revokes sessions. |
| `GET` | `/auth/users/:id` | Fetches a user by ID (admin-only). |
| `GET` | `/auth/users` | Lists users with filters/pagination (admin-only). |
| `POST` | `/auth/users/:id/restore` | Restores a soft-deleted user (admin-only). |
| `POST` | `/auth/users/:id/suspend` | Suspends a user account with reason (admin-only). |
| `POST` | `/auth/mfa/setup` | Starts MFA setup (e.g., generates TOTP secret/QR and backup codes). |
| `POST` | `/auth/mfa/verify-setup` | Verifies MFA setup code and enables MFA. |
| `POST` | `/auth/mfa/challenge` | Creates MFA challenge for current authenticated user. |
| `POST` | `/auth/mfa/verify` | Verifies MFA challenge code. |
| `GET` | `/auth/mfa/devices` | Lists MFA devices for current user. |
| `DELETE` | `/auth/mfa/devices/:id` | Removes a specific MFA device. |
| `PATCH` | `/auth/mfa/devices/:id/primary` | Marks an MFA device as primary. |
| `POST` | `/auth/mfa/backup-codes` | Regenerates backup codes after MFA verification. |
| `POST` | `/auth/mfa/backup-codes/verify` | Verifies a backup code. |
| `POST` | `/auth/mfa/disable` | Disables MFA for current user. |
| `GET` | `/auth/sessions` | Lists active sessions for current user. |
| `DELETE` | `/auth/sessions/:id` | Revokes one specific session. |
| `DELETE` | `/auth/sessions/others` | Revokes all sessions except current one. |
| `POST` | `/auth/sessions/refresh` | Refreshes access token using refresh-token cookie (token rotation). |
| `POST` | `/auth/logout` | Logs out current session and clears refresh cookie. |

## Billing Module Routes (`/billing`)

| Method | Route | What it does |
|---|---|---|
| `GET` | `/billing/plans` | Returns available billing plans. |
| `GET` | `/billing/plans/:planId` | Returns one billing plan by ID. |
| `GET` | `/billing/plans/compare` | Returns plan comparison matrix (limits/features). |
| `POST` | `/billing/plans/estimate` | Estimates plan pricing for interval/coupon inputs. |
| `GET` | `/billing/subscription` | Returns current organization subscription. |
| `POST` | `/billing/subscription` | Creates a subscription for organization. |
| `PATCH` | `/billing/subscription/plan` | Changes organization subscription plan. |
| `POST` | `/billing/subscription/cancel` | Cancels subscription (immediate or period-end). |
| `POST` | `/billing/subscription/reactivate` | Reactivates a canceled/pending-cancel subscription. |
| `POST` | `/billing/subscription/preview-change` | Previews proration/charges for plan change. |
| `GET` | `/billing/payment-methods` | Lists payment methods for organization. |
| `POST` | `/billing/payment-methods` | Adds a new payment method. |
| `PATCH` | `/billing/payment-methods/:id/default` | Sets default payment method. |
| `PATCH` | `/billing/payment-methods/:id` | Updates payment method metadata/details. |
| `DELETE` | `/billing/payment-methods/:id` | Deactivates/removes payment method. |
| `POST` | `/billing/payment-methods/:id/verify` | Triggers payment method verification flow. |
| `GET` | `/billing/invoices` | Lists invoices with optional filters/pagination. |
| `GET` | `/billing/invoices/:id` | Returns invoice by ID. |
| `GET` | `/billing/invoices/:id/pdf` | Redirects to invoice PDF URL when available. |
| `POST` | `/billing/invoices/:id/pay` | Marks/pays an invoice. |
| `GET` | `/billing/invoices/upcoming` | Returns computed upcoming invoice preview. |
| `GET` | `/billing/usage` | Returns current usage summary for organization. |
| `GET` | `/billing/usage/detailed` | Returns detailed usage records by date/granularity. |
| `GET` | `/billing/usage/history` | Returns historical usage for a specific metric type. |
| `GET` | `/billing/usage/forecast` | Returns usage forecast (placeholder in current implementation). |
| `GET` | `/billing/usage/export` | Exports usage report (placeholder response in current implementation). |
| `GET` | `/billing/quotas` | Returns current quota status/metrics. |
| `GET` | `/billing/quotas/:type` | Returns quota details and history for one metric type. |
| `POST` | `/billing/quotas/:type/increase` | Creates a quota increase request. |
| `GET` | `/billing/quotas/requests` | Lists quota increase requests. |
| `GET` | `/billing/settings` | Returns billing settings (tax/terms/notes). |
| `PATCH` | `/billing/settings` | Updates billing settings. |
| `PATCH` | `/billing/settings/email` | Updates billing email metadata (service-level response). |
| `PATCH` | `/billing/settings/address` | Updates billing address metadata (service-level response). |
| `PATCH` | `/billing/settings/tax` | Updates tax settings (tax ID/rate related values). |
| `POST` | `/billing/coupons/apply` | Applies a coupon code if valid. |
| `DELETE` | `/billing/coupons` | Removes applied coupon context. |
| `POST` | `/billing/coupons/validate` | Validates coupon code without applying permanently. |
| `GET` | `/billing/promotions` | Lists promotions (currently placeholder/empty). |
| `POST` | `/billing/webhooks/stripe` | Stripe webhook receiver endpoint. |
| `POST` | `/billing/webhooks/:provider` | Generic payment provider webhook receiver. |
| `POST` | `/billing/admin/sync` | Admin action to force billing sync. |
| `POST` | `/billing/admin/override` | Admin override of subscription billing fields. |
| `POST` | `/billing/admin/credits` | Grants complimentary credits (admin operation). |
| `POST` | `/billing/admin/invoices/:id/waive` | Waives/voids an invoice (admin operation). |
| `GET` | `/billing/admin/analytics` | Returns billing analytics payload (currently placeholder). |
| `POST` | `/billing/portal/session` | Creates customer billing portal session URL. |
| `POST` | `/billing/checkout/session` | Creates checkout session for selected plan. |

## Notes

- Auth module routes are registered under prefix `/auth`.
- Billing module routes are registered under prefix `/billing`.
- Most non-webhook routes require auth middleware.
- Billing module also expects organization context (currently from request context/header usage in routes).
