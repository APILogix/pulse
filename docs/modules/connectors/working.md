# Connectors Module Working & Operational Guide

This document describes connector creation, test ping dispatches, provider payload formatting, and API routes for the **Connectors Module**.

---

## 1. Connector Registration & Test Ping Flow

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Workspace Admin
    participant API as Connectors API
    participant Svc as Connector Service
    participant Sec as Secret Encryptor (AES-GCM)
    participant Provider as Slack / PagerDuty Provider
    participant Remote as External API (Slack / PagerDuty)

    Admin->>API: POST /api/v1/connectors { type: "slack", config: { webhookUrl: "https://hooks.slack.com/..." } }
    API->>Svc: createConnector(orgId, type, config)
    Svc->>Sec: encrypt(config.webhookUrl)
    Svc->>Svc: Store encrypted record in connectors table
    API-->>Admin: 201 Created (Connector ID)
    Admin->>API: POST /api/v1/connectors/:id/test
    API->>Svc: sendTestPing(connectorId)
    Svc->>Sec: decrypt(encryptedConfig)
    Svc->>Provider: formatTestPayload()
    Provider->>Remote: HTTPS POST (Slack BlockKit / PagerDuty Event)
    Remote-->>Provider: 200 OK
    API-->>Admin: 200 OK { success: true, deliveredAt: "..." }
```

---

## 2. API Endpoints

- **`GET /api/v1/connectors`**: Lists configured connectors for the active workspace.
- **`POST /api/v1/connectors`**: Creates a new connector with encrypted credentials.
- **`POST /api/v1/connectors/:id/test`**: Dispatches a test alert notification to verify connectivity.
- **`DELETE /api/v1/connectors/:id`**: Removes connector and unlinks routing policies.
