import { pool } from '../../config/database.js';
function getHeader(request, name) {
    const value = request.headers[name.toLowerCase()];
    return typeof value === 'string' ? value : null;
}
export function getDeviceInfo(request) {
    const ua = getHeader(request, 'user-agent');
    if (!ua)
        return null;
    const browser = ua.match(/Edg\/([\d.]+)/) ? 'Edge' :
        ua.match(/Chrome\/([\d.]+)/) ? 'Chrome' :
            ua.match(/Firefox\/([\d.]+)/) ? 'Firefox' :
                ua.match(/Version\/([\d.]+).*Safari/) ? 'Safari' :
                    'Unknown browser';
    const os = ua.includes('Windows') ? 'Windows' :
        ua.includes('Mac OS X') ? 'macOS' :
            ua.includes('iPhone') || ua.includes('iPad') ? 'iOS' :
                ua.includes('Android') ? 'Android' :
                    ua.includes('Linux') ? 'Linux' :
                        'Unknown OS';
    return `${browser} / ${os}`;
}
export async function logSecurityEvent(userId, eventType, description, request, metadata = {}) {
    await pool.query(`INSERT INTO user_security_events (
       user_id, event_type, description, device_info, ip_address, location, metadata
     ) VALUES ($1, $2, $3, $4, $5::inet, $6, $7::jsonb)`, [
        userId,
        eventType,
        description,
        request ? getDeviceInfo(request) : null,
        request?.ip ?? null,
        null,
        JSON.stringify(metadata),
    ]);
}
//# sourceMappingURL=security-events.js.map