# Webhooks Module Working & Operational Guide

This document describes webhook signature verification, delivery headers, retry schedules, and API endpoints for the **Webhooks Module**.

---

## 1. Signature Verification Standard

Outgoing webhooks carry the standard Svix HMAC-SHA256 signature headers:
```
svix-id: msg_2X1Y4Z...
svix-timestamp: 1723621200
svix-signature: v1,g0hM9N...
```

### Signature Verification Algorithm:
```typescript
const signedContent = `${msgId}.${timestamp}.${rawBody}`;
const expectedSignature = crypto
  .createHmac('sha256', secret)
  .update(signedContent)
  .digest('base64');
```

---

## 2. API Endpoints

- **`GET /api/v1/webhooks`**: Lists registered webhook endpoints.
- **`POST /api/v1/webhooks`**: Registers a new destination URL and subscribed event types.
- **`POST /api/v1/webhooks/:id/test`**: Dispatches an instant test ping event.
- **`GET /api/v1/webhooks/:id/deliveries`**: Paginated delivery logs and HTTP status codes.
