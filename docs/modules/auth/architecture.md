# Authentication Module Architecture

The **Authentication Module** delivers an enterprise-grade identity platform implementing Clean Architecture principles across domain, application, infrastructure, and presentation layers. It supports password-based authentication, SAML 2.0 Enterprise Single Sign-On (SSO), OIDC / Social Login (Google & GitHub), WebAuthn / Passkeys, multi-factor authentication (TOTP & SMS), Magic Links, and secure cryptographically signed session management.

```mermaid
flowchart TD
    subgraph Client ["Client Browser / Mobile / SDK"]
        User["User / Agent"]
    end

    subgraph AuthPresentation ["Presentation Layer (Fastify Routes & Cookies)"]
        LoginRoutes["Login & Password Routes"]
        MFARoutes["MFA & Passkey Routes"]
        SSORoutes["SAML & OIDC SSO Routes"]
        SessionRoutes["Session & Token Routes"]
        CookieMgr["Secure Cookie Manager (Separate Secret)"]
    end

    subgraph AuthApp ["Application Layer (Use Cases)"]
        LoginUC["AuthenticateWithPasswordUseCase"]
        PasskeyUC["AuthenticateWithPasskeyUseCase"]
        SAMLUC["ProcessSamlAssertionUseCase"]
        MFAUC["VerifyTotpMfaUseCase"]
        SessionUC["ManageSessionsUseCase"]
    end

    subgraph AuthInfra ["Infrastructure Layer (Security & Storage)"]
        Bcrypt["Bcrypt Password Hasher (Cost 12)"]
        WebAuthnLib["@simplewebauthn Server Engine"]
        SamlLib["@node-saml SAML Processor"]
        TokenSvc["JWT Token & Session Service"]
        AuthRepo["Auth & Session Repository"]
    end

    subgraph Database ["Primary Database"]
        UserTable[("users")]
        Credentials[("user_credentials")]
        SessionsTable[("user_sessions")]
        PasskeyTable[("user_passkeys")]
        SamlProviders[("organization_sso_configs")]
    end

    User --> AuthPresentation
    AuthPresentation --> CookieMgr
    AuthPresentation --> AuthApp
    AuthApp --> AuthInfra
    AuthInfra --> Database
```

---

## 1. Architectural Layers & Boundaries

1. **Domain Layer (`domain/`)**: Pure entities (`User`, `Session`, `PasskeyCredential`, `MfaPolicy`), domain events, value objects, and business rules without external dependencies.
2. **Application Layer (`application/`)**: Encapsulates use-case workflows (`AuthenticateUser`, `RegisterPasskey`, `InitiateSamlLogin`, `RevokeSession`).
3. **Infrastructure Layer (`infrastructure/`)**: Implements repositories, bcrypt hashing, JWT issuance, WebAuthn cryptographic verification, and SAML assertion parsing.
4. **Presentation Layer (`presentation/`)**: Fastify routes, strict Zod validation schemas, and secure HttpOnly cookie decorators.

---

## 2. Key Security Mechanisms

- **Cookie/JWT Secret Segregation**: `COOKIE_SECRET` and `JWT_SECRET` use independent keys so compromise of one does not forge tokens on the other.
- **CSRF Defense**: Double-submit cookie with `SameSite=Lax` (or `Strict` for mutations) and custom `X-CSRF-Token` header verification.
- **Session Revocation**: Cryptographically unique session IDs stored in `user_sessions` allowing instant single-session or all-session revocation.
- **Brute Force & Rate Limiting**: Exponential backoff on failed password attempts with IP/Account lockout protections.
