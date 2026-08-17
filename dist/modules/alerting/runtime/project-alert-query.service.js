import { pool } from '../../../config/database.js';
import { AlertRuntimeRepository } from './alert-runtime.repository.js';
import { NotificationEntitlementService } from './notification-entitlement.service.js';
import { ProjectOwnerRepository } from './email-only-restricted-routing.js';
export class ProjectAlertQueryService {
    runtime;
    entitlement;
    owners;
    primaryDb;
    constructor(logDb, primaryDb = pool, entitlement, owners) {
        this.runtime = new AlertRuntimeRepository(logDb);
        this.primaryDb = primaryDb;
        this.entitlement = entitlement ?? new NotificationEntitlementService();
        this.owners = owners ?? new ProjectOwnerRepository(primaryDb);
    }
    async list(organizationId, projectId, query) {
        const result = await this.runtime.listProjectAlertEvents(organizationId, projectId, query);
        return result;
    }
    async get(organizationId, projectId, alertEventId) {
        return this.runtime.findProjectAlertEventById(organizationId, projectId, alertEventId);
    }
    async getAlertingStatus(organizationId, projectId) {
        // 1. Resolve entitlement
        const capability = await this.entitlement.resolve(organizationId);
        // 2. Resolve active connectors
        const connectorResult = await this.primaryDb.query(`SELECT id, name, provider, status
         FROM connector_configs
        WHERE organization_id = $1
          AND deleted_at IS NULL
          AND status = 'active'
        ORDER BY created_at ASC`, [organizationId]);
        const activeConnectors = connectorResult.rows.map((row) => ({
            id: row.id,
            name: row.name,
            type: row.provider,
            status: row.status,
        }));
        const primaryConnector = activeConnectors[0] ?? null;
        const configured = activeConnectors.length > 0;
        const connected = activeConnectors.some((c) => c.status === 'active');
        // 3. Resolve project owner & fallback
        const owner = await this.owners.findActiveVerifiedOwner(organizationId, projectId);
        const fallback = await this.owners.findActiveVerifiedFallbackRecipient(organizationId, projectId);
        const fallbackEmail = owner?.email ?? fallback?.email ?? 'No verified email configured';
        const fallbackSource = owner ? 'PROJECT_OWNER' : 'ORGANIZATION_FALLBACK';
        // 4. Default destination resolution
        let defaultDestination;
        if (!capability.connectorAccess || !configured || !primaryConnector) {
            defaultDestination = {
                type: 'PROJECT_OWNER_EMAIL',
                target: fallbackEmail,
                source: fallbackSource,
            };
        }
        else {
            defaultDestination = {
                type: 'PRIMARY_CONNECTOR',
                target: `${primaryConnector.name} (${primaryConnector.type})`,
                source: 'PRIMARY_CONNECTOR',
            };
        }
        return {
            organizationId,
            projectId,
            connectorAccess: {
                allowed: capability.connectorAccess,
                reason: capability.reason,
            },
            connectorStatus: {
                configured,
                connected,
                primary: primaryConnector,
                totalActive: activeConnectors.length,
            },
            defaultDestination,
            fallbackDestination: {
                type: fallbackSource === 'PROJECT_OWNER' ? 'PROJECT_OWNER_EMAIL' : 'ORGANIZATION_FALLBACK',
                target: fallbackEmail,
            },
            projectOwner: owner ? { userId: owner.userId, email: owner.email } : null,
        };
    }
}
//# sourceMappingURL=project-alert-query.service.js.map