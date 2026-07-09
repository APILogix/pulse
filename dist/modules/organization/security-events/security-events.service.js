export class SecurityEventsService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async listSecurityEvents(orgId, userId, q, filters) {
        await this.deps.requireMember(orgId, userId, "admin");
        const result = await this.deps.repository.listSecurityEvents(orgId, q, filters);
        return {
            data: result.data.map(e => ({
                id: e.id,
                userId: e.user_id,
                eventType: e.event_type,
                severity: e.severity,
                ipAddress: e.ip_address,
                metadata: e.metadata,
                createdAt: e.created_at
            })),
            meta: result.meta
        };
    }
}
//# sourceMappingURL=security-events.service.js.map