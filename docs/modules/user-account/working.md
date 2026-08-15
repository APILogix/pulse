# User Account Module Working & Operational Guide

This document describes the APIs, token management, and data export workflows for the **User Account Module**.

---

## 1. Endpoints & Operations

- **`GET /api/v1/user/profile`**: Fetches authenticated user profile, avatar URL, and verified email status.
- **`PATCH /api/v1/user/profile`**: Updates name and preferences.
- **`GET /api/v1/user/sessions`**: Lists all active sessions with device/OS/IP info.
- **`DELETE /api/v1/user/sessions/:sessionId`**: Terminates a specific active session.
- **`POST /api/v1/user/tokens`**: Generates a Personal Access Token (`pat_...`).
- **`POST /api/v1/user/export-data`**: Triggers background GDPR data export and emails download link upon completion.
