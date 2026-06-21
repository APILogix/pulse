/**
 * WebAuthn Relying Party configuration derived from environment.
 */
import { env } from '../../config/env.js';
function resolveOrigin() {
    const base = env.FRONTEND_URL || env.APP_URL;
    return base.replace(/\/+$/, '');
}
function resolveRpId() {
    if (process.env.WEBAUTHN_RP_ID) {
        return process.env.WEBAUTHN_RP_ID;
    }
    try {
        return new URL(resolveOrigin()).hostname;
    }
    catch {
        return 'localhost';
    }
}
export const webauthnConfig = {
    rpName: process.env.WEBAUTHN_RP_NAME || env.APP_NAME,
    rpID: resolveRpId(),
    origin: resolveOrigin(),
};
//# sourceMappingURL=webauthn.config.js.map