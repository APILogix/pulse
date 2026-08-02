import type { OrgRole } from '../../projects/types.js';
export declare const CONNECTOR_PERMISSIONS: {
    readonly viewConnectors: "connectors:view";
    readonly createConnector: "connectors:create";
    readonly updateConnector: "connectors:update";
    readonly deleteConnector: "connectors:delete";
    readonly rotateSecret: "connectors:rotate_secret";
    readonly testConnection: "connectors:test";
    readonly viewAudit: "connectors:audit:view";
    readonly viewDeliveries: "connectors:deliveries:view";
    readonly manageRoutes: "connectors:routes:manage";
};
export type ConnectorPermission = typeof CONNECTOR_PERMISSIONS[keyof typeof CONNECTOR_PERMISSIONS];
export declare const REQUIRED_ROLE_BY_CONNECTOR_PERMISSION: Record<ConnectorPermission, OrgRole>;
//# sourceMappingURL=permission.constants.d.ts.map