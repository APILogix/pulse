# Authentication Module Future Updates & Roadmap

This document describes upcoming security enhancements, identity upgrades, and protocol migrations for the **Authentication Module**.

---

## 1. Planned Enhancements

1. **Argon2id Password Hashing**: Migration from `bcrypt` to `Argon2id` (RFC 9106) for superior memory-hard resistance against GPU-based cracking.
2. **Enterprise SCIM 2.0 Integration**: Direct pairing with the SCIM module for automated identity provisioning.
3. **Hardware Security Key (FIDO2 Level 3) Policies**: Organization-level enforcement of physical hardware security keys (e.g. YubiKey) for elevated admin privileges.
4. **Adaptive Risk-Based Authentication**: Automated step-up authentication challenges triggered on new geolocation, novel IP ranges, or anomalous user agent strings.
