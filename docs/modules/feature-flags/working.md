# Feature Flags Module Working & Operational Guide

This document describes targeting rule structures, evaluation algorithms, and API endpoints for the **Feature Flags Module**.

---

## 1. Flag Evaluation Workflow

```mermaid
sequenceDiagram
    autonumber
    actor SDK as Application / Client SDK
    participant API as Feature Flags API
    participant Cache as Flag In-Memory Cache
    participant Eval as Rule Evaluator

    SDK->>API: POST /api/v1/flags/evaluate { flagKey: "new-billing-ui", context: { userId: "u_123", email: "alice@acme.com", plan: "enterprise" } }
    API->>Cache: Get Flag Definition
    alt Cache Miss
        Cache->>Cache: Load from Database & Cache
    end
    API->>Eval: evaluate(flag, context)
    Eval->>Eval: Check Flag Enabled State (Kill Switch)
    Eval->>Eval: Evaluate Targeting Rules (Matches: email == '@acme.com')
    Eval->>Eval: Calculate Percentage Rollout Hash (Hash % 100 <= 25)
    Eval-->>API: Result: { enabled: true, variant: "v2-checkout" }
    API-->>SDK: 200 OK
```

---

## 2. API Endpoints

- **`GET /api/v1/flags`**: Lists feature flags for the current project.
- **`POST /api/v1/flags`**: Creates a new boolean or multivariate flag.
- **`PATCH /api/v1/flags/:id`**: Toggles flag enabled state or updates targeting rules.
- **`POST /api/v1/flags/evaluate`**: Evaluates all flags for a given user context.
