export function isConnectorTransportJob(value) {
    if (!value || typeof value !== 'object')
        return false;
    const job = value;
    return typeof job.organizationId === 'string'
        && typeof job.notificationJobId === 'string'
        && typeof job.connectorId === 'string'
        && typeof job.channelKind === 'string'
        && typeof job.severity === 'string'
        && typeof job.idempotencyKey === 'string'
        && typeof job.correlationId === 'string'
        && !!job.payload
        && typeof job.payload === 'object'
        && !Array.isArray(job.payload);
}
export function isManagedEmailJob(value) {
    if (!value || typeof value !== 'object')
        return false;
    const job = value;
    return typeof job.organizationId === 'string'
        && typeof job.notificationJobId === 'string'
        && typeof job.recipientUserId === 'string'
        && typeof job.recipientEmail === 'string'
        && (job.provider === 'MANAGED_EMAIL' || job.provider === 'EMAIL' || !job.connectorId)
        && typeof job.severity === 'string'
        && typeof job.idempotencyKey === 'string'
        && !!job.payload
        && typeof job.payload === 'object'
        && !Array.isArray(job.payload);
}
//# sourceMappingURL=transport.types.js.map