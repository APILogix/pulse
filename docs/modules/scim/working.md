# SCIM 2.0 Module Working & Operational Guide

This document describes the SCIM 2.0 API specifications, JSON schema representations, and IdP provisioning synchronization mechanics for the **SCIM Module**.

---

## 1. SCIM Operations & API Contracts

### 1.1 User Provisioning (`POST /scim/v2/Users`)
- **Headers**: `Authorization: Bearer scim_token_...`
- **Request Body (RFC 7643 User Resource)**:
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "alice@acme.com",
  "name": {
    "givenName": "Alice",
    "familyName": "Smith"
  },
  "emails": [
    {
      "value": "alice@acme.com",
      "primary": true
    }
  ],
  "active": true
}
```
- **Response `201 Created`**:
```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "77777777-8888-9999-0000-111111111111",
  "userName": "alice@acme.com",
  "name": { "givenName": "Alice", "familyName": "Smith" },
  "active": true,
  "meta": {
    "resourceType": "User",
    "created": "2026-08-14T07:45:00.000Z",
    "lastModified": "2026-08-14T07:45:00.000Z"
  }
}
```

---

## 2. Supported Endpoints

- `GET /scim/v2/Users`: Filter and list provisioned users.
- `POST /scim/v2/Users`: Create and provision new user.
- `GET /scim/v2/Users/:id`: Retrieve user by SCIM ID.
- `PATCH /scim/v2/Users/:id`: Update user attributes or deactivate (`active: false`).
- `DELETE /scim/v2/Users/:id`: Deprovision user.
- `GET /scim/v2/Groups`: List synced groups and roles.
- `GET /scim/v2/ServiceProviderConfig`: Advertises supported SCIM features and patch operations.
