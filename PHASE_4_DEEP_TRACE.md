
====================================================
## PHASE 4 — ROUTE → SERVICE → REPOSITORY FLOW (DEEP TRACE)
====================================================

### GET /metrics
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /health
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /live
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /ready
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /health/live
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /health/ready
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/events
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/events/:eventId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/requests/overview
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/dashboard
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/error-groups
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:projectId/error-groups/:fingerprint
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/error-groups/:fingerprint/resolve
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/health
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /types
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:id/details
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:id/enable
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:id/disable
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:id/rotate-secret
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:id/test
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:id/health-check
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:id/health-history
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:id/test-runs
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:id/send
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:id/deliveries
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /deliveries/:deliveryId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /deliveries/:deliveryId/retry
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:id/deliveries/:deliveryId/attempts
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:id/audit
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /audit
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:id/routes
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:id/routes
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:id/routes/:routeId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:id/routes/:routeId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:id/oauth/start
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:id/oauth/callback
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:id/oauth/refresh
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:id/oauth/disconnect
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /preview
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /validate-configuration
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /overview
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /trends
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /health
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /errors
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /errors/groups
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /errors/trends
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /errors/groups/:fingerprint
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /errors/groups/:fingerprint/resolve
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /errors/groups/:fingerprint/ignore
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /errors/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /performance/routes
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /performance/distribution
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /performance/apdex
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /requests
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /requests/waterfall/:traceId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /requests/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /traces
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /traces/:traceId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /metrics
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /metrics/:name/stats
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /metrics/:name
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /logs
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /logs/stream
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /sessions
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /sessions/:sessionId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /users
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /users/:userId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /crons
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /crons/:slug/history
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /crons/:slug
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /live/errors
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /dashboards
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /dashboards
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /dashboards/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /dashboards/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /dashboards/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /dashboards/:id/duplicate
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /queries
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /queries
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /queries/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /queries/:id/execute
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /alerts
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /alerts
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /alerts/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /export
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /v1/init
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /v1/ingest
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /v1/ingest/requests
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /v1/ingest/errors
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /v1/ingest/logs
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /v1/ingest/metrics
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /v1/health
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /v1/ingest/health
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /v1/limits
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /v1/usage
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /v1/errors
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /v1/errors/:errorId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /v1/dlq
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /v1/dlq/reprocess/:jobId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /v1/dlq/reprocess-all
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /v1/replay
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /v1/debug/events/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /switch
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:id/archive
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:id/restore
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:id/transfer-ownership
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/settings
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:orgId/settings
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/members
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/members/me
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/members/:userId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:orgId/members/:userId/role
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:orgId/members/:userId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/members/:userId/suspend
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/members/:userId/reactivate
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/leave
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/invitations
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/invitations
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/invitations/:invitationId/resend
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:orgId/invitations/:invitationId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /invitations/accept
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /invitations/:id/decline
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /invitations/validate
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/sso
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/sso
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:orgId/sso/:ssoId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:orgId/sso/:ssoId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/scim-tokens
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/scim-tokens
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/scim-tokens/:tokenId/rotate
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:orgId/scim-tokens/:tokenId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/security-events
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/audit-logs
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/audit-logs/export
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/quota-requests
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/quota-requests
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/quota-requests/:requestId/approve
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/quota-requests/:requestId/reject
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/billing-summary
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/usage-limits
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /slug-available/:slug
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /by-slug/:slug
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/ServiceProviderConfig
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/ResourceTypes
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/Schemas
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/Users
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/Users/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/Users
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PUT /:orgId/Users/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:orgId/Users/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:orgId/Users/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/Groups
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/Groups
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/Groups/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PUT /:orgId/Groups/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:orgId/Groups/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:orgId/Groups/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /events
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /events
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /events/stats
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /events/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /events/:id/acknowledge
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /events/:id/resolve
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /events/:id/silence
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /events/:id/deliveries
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /dead-letters
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /dead-letters/:id/retry
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /dead-letters/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /metrics
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /escalation-policies
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /escalation-policies
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /escalation-policies/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /escalation-policies/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PUT /escalation-policies/:id/steps
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /routing-rules
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /routing-rules
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /routing-rules/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /routing-rules/test
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /rules
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /rules/templates
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /rules/templates/:templateKey
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /rules
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /rules/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /rules/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /rules/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /rules/:id/enable
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /rules/:id/disable
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /rules/:id/test
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /rules/:id/clone
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /silences
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /silences
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /silences/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /templates
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /templates
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /templates/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /templates/:id/preview
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /consume
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /validate
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /apply
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /check
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /upcoming
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:invoiceId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:invoiceId/pay
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /public
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /compare
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:planId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /estimate
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /history
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /change-plan
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /upgrade
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /downgrade
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /cancel
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /current
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /daily
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /increment-events
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /stripe
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /razorpay
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:organizationId/domains
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:organizationId/domains/:domainId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:organizationId/domains
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:organizationId/domains/:domainId/verify
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:organizationId/domains/:domainId/recheck
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:organizationId/domains/:domainId/enable-auto-join
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:organizationId/domains/:domainId/disable-auto-join
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:organizationId/domains/:domainId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:organizationId/domains/:domainId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:organizationId/domains/:domainId/make-primary
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/sdk-configs
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/sdk-configs
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/sdk-configs/resolve
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/sdk-configs/:configId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:orgId/sdk-configs/:configId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/sdk-configs/:configId/rollback
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/sdk-configs/:configId/versions
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/sdk-configs/:configId/versions/:version
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:orgId/sdk-configs/:configId/deployments
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:orgId/sdk-configs/:configId/versions/:version/ack
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/activity
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/api-keys
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/api-keys
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/api-keys/bulk-rotate
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/api-keys/bulk-revoke
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/api-keys/:apiKeyId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:projectId/api-keys/:apiKeyId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:projectId/api-keys/:apiKeyId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/api-keys/:apiKeyId/rotate
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/api-keys/:apiKeyId/regenerate
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/api-keys/:apiKeyId/enable
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/api-keys/:apiKeyId/disable
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/api-keys/:apiKeyId/usage
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/stats
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/usage
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:projectId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:projectId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/overview
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/sdk-configs
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/sdk-configs/resolve
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/sdk-configs/:configId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:projectId/sdk-configs/:configId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/environments
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/environments
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/environments/:environmentId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:projectId/environments/:environmentId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:projectId/environments/:environmentId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/members
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/members
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:projectId/members/:memberId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:projectId/members/:memberId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/transfer-ownership
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/invitations
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/invitations
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/invitations/accept
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/invitations/:invitationId/decline
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:projectId/invitations/:invitationId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/roles
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/roles
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:projectId/roles/:roleId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:projectId/roles/:roleId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/settings
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:projectId/settings
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/analytics/usage
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/analytics/heatmap
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/analytics/top
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/analytics/comparison
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/analytics/monthly-usage
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /mfa/step-up/webauthn/options
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /mfa/step-up/webauthn/verify
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /mfa/devices/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /users/:id/password/reset
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /password/policy
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /users/me/verification
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /policy/effective
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /sso/discovery
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /account/unlock/request
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /account/unlock/confirm
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /users/me/export
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /users/me/delete/request
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /users/me/delete/confirm
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /mfa/recovery/request
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /users/:id/audit-events
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /health
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /login
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /login/mfa
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /login/mfa/switch
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /login/backup-code
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /mfa/setup
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /mfa/verify-setup
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /mfa/challenge
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /mfa/verify
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /mfa/email/resend
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /mfa/devices
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /mfa/devices/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /mfa/devices/:id/primary
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /mfa/backup-codes
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /mfa/toggle
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /mfa/disable
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /mfa/disable/request
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /mfa/disable/confirm
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /forgot-password
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /password/forgot
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /reset-password
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /password/reset
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /resend-verification
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /verify-email
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /verify-email/confirm
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /password/change
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /login/social/:provider
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /login/social/:provider/authorize
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /login/social/callback
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /identity-providers/:provider/link
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /identity-providers/:provider/authorize
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /identity-providers
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /identity-providers/:linkId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /saml/logout
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /saml/slo
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /saml/metadata
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /saml/acs
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /sessions
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /sessions
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /sessions/others
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /sessions/refresh
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /logout
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /sso/login
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /sso/callback
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /mfa/webauthn/register/options
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /mfa/webauthn/register/verify
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /login/mfa/webauthn/options
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /login/mfa/webauthn/verify
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /trusted-devices
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /trusted-devices
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /trusted-devices/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /register
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /users
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /users/me
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /users/me/security-summary
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /users/me
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /users/me
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /users/:id
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /users
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /users/:id/restore
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /users/:id/suspend
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /users/:id/unsuspend
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /users/:id/lock
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /users/:id/unlock
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /users/:id/sessions
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /organizations/:orgId/connectors/slack/oauth/start
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /connectors/slack/oauth/callback
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /organizations/:orgId/connectors/:id/slack/channels
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:prefId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /sync
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:routeId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:routeId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:routeId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:routeId/toggle
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/connectors
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### POST /:projectId/connectors
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### GET /:projectId/connectors/:subscriptionId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### PATCH /:projectId/connectors/:subscriptionId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

### DELETE /:projectId/connectors/:subscriptionId
↓ Controller Handler
↓ Services Invoked: Direct or unresolved
↓ Database Tables Touched: Unknown / Traced implicitly

Total routes traced: 402
