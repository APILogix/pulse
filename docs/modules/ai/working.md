# AI Module Working & Operational Guide

This document describes the operational workflow, context compilation, prompt templates, and streaming chat APIs of the **AI Module**.

---

## 1. Automated Root Cause Analysis Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant API as AI API (/api/v1/ai)
    participant Ctx as Context Builder
    participant Sec as Security & PII Sanitizer
    participant LLM as OpenAI / Neon AI Gateway
    participant Cost as Cost Tracker

    Dev->>API: POST /api/v1/ai/analyze-error { errorId: "..." }
    API->>Ctx: buildInvestigationContext(errorId)
    Ctx->>Ctx: Fetch Error Stack, Linked Traces & Correlated DB Queries
    Ctx->>Sec: sanitizePromptContext(context)
    Sec->>Sec: Strip Bearer Tokens, Passwords, Card Numbers
    Sec->>LLM: Send Structured Prompt with System Rules
    LLM-->>API: Streamed Analysis (Root Cause, Fix, Confidence)
    API->>Cost: recordTokens(promptTokens, completionTokens, model)
    API-->>Dev: 200 OK (Structured RCA Analysis JSON)
```

---

## 2. API Endpoints

- **`POST /api/v1/ai/analyze-error`**: Generates automated root cause analysis for a specific error group.
- **`POST /api/v1/ai/chat`**: Streaming conversational assistant for interactive system debugging.
- **`GET /api/v1/ai/usage`**: Returns organization AI token consumption and remaining monthly quota.
