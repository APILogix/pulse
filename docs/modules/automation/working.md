# Automation Module Working & Operational Guide

This document describes playbook configurations, action triggers, and API routes for the **Automation Module**.

---

## 1. Automation Playbook Execution Flow

```mermaid
sequenceDiagram
    autonumber
    participant Source as Telemetry / Alert Event
    participant Worker as Automation Worker
    participant Evaluator as Condition Evaluator
    participant SSRF as SSRF Validator
    participant Action as Action Runner
    participant Target as External Service (e.g. CI/CD Webhook)

    Source->>Worker: Enqueue automation-job (trigger: error_spike)
    Worker->>Evaluator: Check playbook condition rules
    Evaluator->>Evaluator: Validate Regex & Field Matchers
    alt Condition Matches
        Worker->>SSRF: Validate Target Webhook URL
        alt URL is Public & Safe
            Worker->>Action: Execute Webhook Action (Payload & HMAC)
            Action->>Target: POST /deployments/rollback
            Target-->>Action: 200 OK
            Action->>Worker: Record Success in Automation Audit Log
        else URL is Private / Metadata IP
            Worker->>Worker: Block Request (SSRF_BLOCKED) & Log Security Event
        end
    end
```

---

## 2. API Endpoints

- **`GET /api/v1/automations`**: Lists configured playbooks.
- **`POST /api/v1/automations`**: Creates a new automation playbook with triggers and actions.
- **`POST /api/v1/automations/:id/test`**: Dry-run tests playbook against sample telemetry payload.
- **`GET /api/v1/automations/:id/logs`**: Retrieves execution history and status codes.
