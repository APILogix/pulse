import type { OrgRole } from '../../projects/types.js';

export const CONNECTOR_PERMISSIONS = {
  viewConnectors: 'connectors:view',
  createConnector: 'connectors:create',
  updateConnector: 'connectors:update',
  deleteConnector: 'connectors:delete',
  rotateSecret: 'connectors:rotate_secret',
  testConnection: 'connectors:test',
  viewAudit: 'connectors:audit:view',
  viewDeliveries: 'connectors:deliveries:view',
  manageRoutes: 'connectors:routes:manage',
} as const;

export type ConnectorPermission = typeof CONNECTOR_PERMISSIONS[keyof typeof CONNECTOR_PERMISSIONS];

export const REQUIRED_ROLE_BY_CONNECTOR_PERMISSION: Record<ConnectorPermission, OrgRole> = {
  [CONNECTOR_PERMISSIONS.viewConnectors]: 'viewer',
  [CONNECTOR_PERMISSIONS.createConnector]: 'admin',
  [CONNECTOR_PERMISSIONS.updateConnector]: 'admin',
  [CONNECTOR_PERMISSIONS.deleteConnector]: 'admin',
  [CONNECTOR_PERMISSIONS.rotateSecret]: 'admin',
  [CONNECTOR_PERMISSIONS.testConnection]: 'developer',
  [CONNECTOR_PERMISSIONS.viewAudit]: 'security',
  [CONNECTOR_PERMISSIONS.viewDeliveries]: 'viewer',
  [CONNECTOR_PERMISSIONS.manageRoutes]: 'admin',
};
