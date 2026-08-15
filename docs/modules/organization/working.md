# Organization Module Working & Operational Guide

This document describes the operational workflows, invitation acceptance lifecycles, and API specifications for the **Organization Module**.

---

## 1. Member Invitation Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Org Admin
    participant API as Org API
    participant Svc as OrganizationService
    participant Mailer as Email Queue (pg-boss)
    actor Invitee as Invited User

    Admin->>API: POST /api/v1/organizations/:orgId/invitations { email: "dev@acme.com", role: "member" }
    API->>Svc: createInvitation(orgId, email, role, inviterId)
    Svc->>Svc: Generate Cryptographic Token & 7-day Expiry
    Svc->>Mailer: Enqueue org-invite-email Job
    API-->>Admin: 201 Created (Invitation Details)
    Mailer-->>Invitee: Delivery of Invite Link with Token
    Invitee->>API: POST /api/v1/organizations/invitations/accept { token }
    API->>Svc: acceptInvitation(token, userId)
    Svc->>Svc: Add to organization_members & Delete Token
    API-->>Invitee: 200 OK (Organization Membership Confirmed)
```

---

## 2. API Endpoints

- **`GET /api/v1/organizations`**: Lists organizations current user belongs to.
- **`POST /api/v1/organizations`**: Creates a new organization workspace.
- **`GET /api/v1/organizations/:orgId/members`**: Lists members and roles.
- **`POST /api/v1/organizations/:orgId/invitations`**: Invites a new team member.
- **`GET /api/v1/organizations/:orgId/audit-logs`**: Retrieves audit trail filtered by actor, action, and date range.
