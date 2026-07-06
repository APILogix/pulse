import { pool } from "../../config/database.js";
import { v4 as generateUUID } from "uuid";
export class AlertRouterService {
    preferenceService;
    deliveryService;
    logger;
    constructor(preferenceService, deliveryService, logger) {
        this.preferenceService = preferenceService;
        this.deliveryService = deliveryService;
        this.logger = logger;
    }
    async processAlert(payload) {
        const { orgId, projectId, environment, sourceService, eventType, severity } = payload;
        // 2. Match routes
        const res = await pool.query(`
      SELECT * FROM notification_routes
      WHERE organization_id = $1
        AND (project_id = $2 OR project_id IS NULL)
        AND is_active = true
        AND deleted_at IS NULL
        AND ($3 = ANY(event_types) OR event_types = '{}')
        AND ($4 = ANY(severity_levels) OR severity_levels = '{}')
        AND ($5 = ANY(source_services) OR source_services = '{}')
      ORDER BY priority DESC
    `, [orgId, projectId, eventType, severity, sourceService]);
        const routes = res.rows;
        // 3. For each route, resolve recipients if project-scoped
        for (const route of routes) {
            const recipients = route.project_id
                ? await this.preferenceService.resolveRecipients(route.project_id, route.id, severity)
                : null; // org-wide route: connector handles broadcasting (e.g., Slack channel)
            // 4. Fan out to connectors
            for (const connectorId of route.target_connector_ids) {
                await this.deliveryService.enqueue({
                    organization_id: orgId,
                    project_id: projectId,
                    connector_id: connectorId,
                    route_id: route.id,
                    severity,
                    payload,
                    recipients, // NULL for org-wide, string[] for project-scoped
                    correlation_id: generateUUID(),
                });
            }
        }
    }
}
//# sourceMappingURL=alert-router.service.js.map