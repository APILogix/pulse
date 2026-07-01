# Pulse API Analysis

This file was generated from the mounted modules registered in `pulse/src/app.ts` on 2026-07-01.

## Active Modules

### Auth
- Prefix: `/auth`
- Route files: `src/modules/auth/routes.ts`, `src/modules/auth/account-administration.routes.ts`, `src/modules/auth/identity.routes.ts`, `src/modules/auth/provisioning.routes.ts`, `src/modules/auth/saml-identity.routes.ts`, `src/modules/auth/sso-oidc.routes.ts`
- Route count: 83

### SCIM
- Prefix: `/scim/v2`
- Route files: `src/modules/scim/scim.routes.ts`
- Route count: 11

### Organizations
- Prefix: `/organizations`
- Route files: `src/modules/organization/routes.ts`, `src/modules/organization/sdk-config.routes.ts`
- Route count: 58

### Billing
- Prefix: `/billing`
- Route files: `src/modules/billing/routes.ts`
- Route count: 48

### Projects
- Prefix: `/organizations/:orgId/projects`
- Route files: `src/modules/projects/routes.ts`
- Route count: 24

### Analytics
- Prefix: `/analytics`
- Route files: `src/modules/analytics/routes.ts`
- Route count: 8

### Ingestion
- Prefix: `/api`
- Route files: `src/modules/ingestion/routes.ts`
- Route count: 17

### Connectors
- Prefix: `/organizations/:orgId/connectors`
- Route files: `src/modules/connectors/routes.ts`
- Route count: 9

### Alerting
- Prefix: `/organizations/:orgId/alerting`
- Route files: `src/modules/alerting/routes.ts`
- Route count: 34

### Event Analytics
- Prefix: `/organizations/:orgId/analytics`
- Route files: `src/modules/event-analytics/routes.ts`
- Route count: 45

Total active routes discovered: **337**

## Auth Notes

- `auth` mixes public routes, bearer-protected routes, social login callbacks, and cookie-based session refresh.
- `scim` is mounted separately under `/scim/v2` and typically uses bearer SCIM tokens rather than user access tokens.
- `ingestion` uses project API key auth for `/api/v1/init`, `/api/v1/ingest*`, and `/api/v1/limits`, while operational and replay endpoints use user auth.
- `billing` routes generally require bearer auth plus `x-org-id`, except provider webhooks.

## Inactive Route Files

- `src/modules/ai/routes.ts` exists in the repo but is not mounted by `pulse/src/app.ts`, so it is not included in the generated collection.
- `src/modules/webhooks/routes.ts` exists in the repo but is not mounted by `pulse/src/app.ts`, so it is not included in the generated collection.

## Collection Output

- Postman collection: `pulse/postman/pulse-complete.postman_collection.json`
- Generated from source, with existing request examples reused from `pulse/postman/api-monitoring-backend.postman_collection.json` when available.

