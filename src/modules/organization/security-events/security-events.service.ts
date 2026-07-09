import type { SecurityEventsRepository } from "./security-events.repository.js";
import type { SecurityEventDto, CursorPaginationQuery, OrgMemberRow, OrgRole } from "../types.js";

export interface SecurityEventsServiceDependencies {
  repository: SecurityEventsRepository;
  requireMember: (orgId: string, userId: string, minRole?: OrgRole) => Promise<OrgMemberRow>;
}

export class SecurityEventsService {
  constructor(private readonly deps: SecurityEventsServiceDependencies) {}

  async listSecurityEvents(orgId: string, userId: string, q: CursorPaginationQuery, filters?: { severity?: string; eventType?: string }) {
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
      }) as SecurityEventDto),
      meta: result.meta
    };
  }
}
