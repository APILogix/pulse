# Projects Module Working & Operational Guide

This document describes the API key generation lifecycle, SDK configuration compilation, and API routes of the **Projects Module**.

---

## 1. API Key Generation & Rotation Flow

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant API as Projects API
    participant KeySvc as ApiKeyService
    participant DB as project_api_keys DB

    Dev->>API: POST /api/v1/projects/:projectId/api-keys { name: "Backend Prod", environmentId: "..." }
    API->>KeySvc: generateApiKey(projectId, environmentId)
    KeySvc->>KeySvc: Generate prefix (pk_live_...) & random secret
    KeySvc->>KeySvc: Compute SHA-256 Hash of raw key
    KeySvc->>DB: INSERT into project_api_keys (public_key, secret_hash)
    KeySvc-->>API: Return raw secret string
    API-->>Dev: 201 Created { apiKey: "pk_live_ab12cd34_...", id: "..." }
    Note over Dev,API: Raw secret is never stored and cannot be retrieved again
```

---

## 2. API Endpoints

- **`GET /api/v1/projects`**: Lists all projects in active organization.
- **`POST /api/v1/projects`**: Creates a new project with default environments (`production`, `staging`, `development`).
- **`POST /api/v1/projects/:projectId/api-keys`**: Issues a new API key.
- **`POST /api/v1/projects/:projectId/api-keys/:keyId/rotate`**: Starts graceful key rotation with configurable grace period.
- **`GET /api/v1/projects/:projectId/sdk-config`**: Retrieves compiled SDK configuration payload.
