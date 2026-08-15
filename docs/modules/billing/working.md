# Billing Module Working & Operational Guide

This document describes the Stripe checkout flows, webhook handling, and usage metering APIs of the **Billing Module**.

---

## 1. Stripe Checkout & Provisioning Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Organization Owner
    participant API as Billing API
    participant Stripe as Stripe Billing Engine
    participant DB as Subscriptions DB

    Admin->>API: POST /api/v1/billing/checkout { planId: "team-monthly" }
    API->>Stripe: Create Stripe Checkout Session (orgId in metadata)
    Stripe-->>API: Checkout URL (https://checkout.stripe.com/...)
    API-->>Admin: 200 OK { url: "..." }
    Admin->>Stripe: Completes Payment on Stripe Checkout
    Stripe->>API: POST /api/v1/billing/webhooks (checkout.session.completed)
    API->>API: Verify stripe-signature HMAC
    API->>DB: INSERT/UPDATE organization_subscriptions (status: 'active', plan_id)
    API-->>Stripe: 200 OK (Webhook Acknowledged)
```

---

## 2. API Endpoints

- **`GET /api/v1/billing/plans`**: Returns available plans and pricing.
- **`POST /api/v1/billing/checkout`**: Initiates Stripe Checkout session.
- **`POST /api/v1/billing/portal`**: Generates Stripe Customer Portal link for payment method updates.
- **`GET /api/v1/billing/subscription`**: Returns active subscription details, renewal date, and seat count.
- **`GET /api/v1/billing/usage`**: Current billing period event consumption and quota percentage.
- **`POST /api/v1/billing/webhooks`**: Stripe webhook receiver endpoint.
