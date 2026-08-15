# Authentication Module Working & Operational Guide

This document provides complete API contracts, authentication flows, and security mechanics for the **Authentication Module**.

---

## 1. Authentication Flows

### 1.1 Password + MFA Login Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as User Browser
    participant API as Auth API (/api/v1/auth)
    participant UseCase as LoginUseCase
    participant Hash as Bcrypt Hasher
    participant DB as Users / Credentials DB
    participant Cookie as Cookie Manager

    User->>API: POST /api/v1/auth/login { email, password }
    API->>UseCase: execute(email, password)
    UseCase->>DB: findUserByEmail(email)
    DB-->>UseCase: User & Hashed Password
    UseCase->>Hash: compare(password, hash)
    alt Password Matches & MFA Disabled
        UseCase->>DB: createSession(userId, ip, userAgent)
        UseCase->>Cookie: Set HttpOnly signed session cookie
        API-->>User: 200 OK (User Profile + Session Cookie)
    else Password Matches & MFA Enabled
        UseCase-->>API: MFA Challenge Required (mfaToken)
        API-->>User: 200 OK { mfaRequired: true, mfaToken: "..." }
        User->>API: POST /api/v1/auth/mfa/verify { mfaToken, code: "123456" }
        API->>UseCase: verifyMfa(mfaToken, code)
        UseCase->>Cookie: Set HttpOnly session cookie
        API-->>User: 200 OK (User Profile)
    end
```

---

## 2. API Endpoints

- **`POST /api/v1/auth/register`**: User registration with email verification dispatch.
- **`POST /api/v1/auth/login`**: Credential authentication returning session cookies.
- **`POST /api/v1/auth/logout`**: Invalidates active session in database and clears cookies.
- **`POST /api/v1/auth/passkeys/generate-options`**: WebAuthn registration challenge generation.
- **`POST /api/v1/auth/passkeys/verify`**: WebAuthn credential public key registration.
- **`POST /api/v1/auth/sso/saml/login`**: Generates SAML 2.0 AuthNRequest to Enterprise IdP (Okta, Azure AD).
- **`POST /api/v1/auth/sso/saml/callback`**: Handles SAML ACS response, validates signatures, and provisions session.
