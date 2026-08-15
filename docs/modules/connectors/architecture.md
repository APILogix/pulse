# Connectors Module Architecture

The **Connectors Module** is the outbound integration and notification hub of the Pulsiv platform. It delivers notifications and alert events to third-party communication and incident management platforms, including Slack (Block Kit), PagerDuty (Events API v2), Discord, Opsgenie, Microsoft Teams, GitHub, and generic HTTPS webhooks.

```mermaid
flowchart TD
    subgraph EventSources ["Alerting & Automation Triggers"]
        Alert["Alert Incident / Recovery Event"]
    end

    subgraph ConnectorEngine ["Connectors Dispatch Engine"]
        Registry["Connector Provider Registry"]
        Secrets["Encrypted Token & Webhook Storage (AES-256-GCM)"]
        Router["Dynamic Channel Dispatcher"]
        Formatters["Provider Payload Formatters (BlockKit, PD JSON, Discord Embeds)"]
        DeliveryWorker["Delivery Queue Worker (pg-boss: connector-delivery)"]
        CircuitBreaker["Circuit Breaker & Backoff Engine"]
    end

    subgraph ExternalPlatforms ["External Incident & Chat Platforms"]
        Slack["Slack Webhook / Bot API"]
        PD["PagerDuty Events API v2"]
        Discord["Discord Webhooks"]
        Teams["MS Teams Adaptive Cards"]
        GenericWH["Custom HTTPS Webhooks"]
    end

    Alert --> DeliveryWorker
    DeliveryWorker --> Router
    Router --> Registry
    Registry --> Secrets
    Registry --> Formatters
    Formatters --> CircuitBreaker
    CircuitBreaker --> Slack
    CircuitBreaker --> PD
    CircuitBreaker --> Discord
    CircuitBreaker --> Teams
    CircuitBreaker --> GenericWH
```

---

## 1. Core Architectural Responsibilities

1. **Provider Abstraction Registry**: Modular provider interface (`SlackProvider`, `PagerDutyProvider`, `DiscordProvider`, `TeamsProvider`, `WebhookProvider`) standardizing authentication, formatting, and delivery.
2. **Encrypted Secret Storage**: All webhook URLs, OAuth bot tokens, and routing keys are encrypted at rest using AES-256-GCM (`secrets/`).
3. **Resilient Delivery & Exponential Backoff**: Outbound requests employ circuit breakers (`opossum`) and retry queues with jittered exponential backoff to handle upstream provider downtime.
4. **Health Monitoring & Auto-Disabling**: Background monitor checks connector health and flags consistently failing integrations as degraded.

---

## 2. Key Components & Files

| Component | Location | Description |
| :--- | :--- | :--- |
| **`service.ts`** | [`pulse/src/modules/connectors/service.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/connectors/service.ts) | Connector CRUD, test dispatch, and verification orchestrator. |
| **`registry.ts`** | [`pulse/src/modules/connectors/registry.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/connectors/registry.ts) | Provider factory and formatter registration. |
| **`queue.ts`** | [`pulse/src/modules/connectors/queue.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/connectors/queue.ts) | Asynchronous delivery worker with retry policies. |
| **`monitor.ts`** | [`pulse/src/modules/connectors/monitor.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/connectors/monitor.ts) | Background health checker for registered connectors. |
