import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_PERMISSIONS,
  REQUIRED_ROLE_BY_CONNECTOR_PERMISSION,
} from '../../../src/modules/connectors/middleware/permission.constants.js';

describe('connector permission mapping', () => {
  it('covers every required enterprise connector permission', () => {
    expect(CONNECTOR_PERMISSIONS).toEqual({
      viewConnectors: 'connectors:view',
      createConnector: 'connectors:create',
      updateConnector: 'connectors:update',
      deleteConnector: 'connectors:delete',
      rotateSecret: 'connectors:rotate_secret',
      testConnection: 'connectors:test',
      viewAudit: 'connectors:audit:view',
      viewDeliveries: 'connectors:deliveries:view',
      manageRoutes: 'connectors:routes:manage',
    });

    for (const permission of Object.values(CONNECTOR_PERMISSIONS)) {
      expect(REQUIRED_ROLE_BY_CONNECTOR_PERMISSION[permission]).toBeDefined();
    }
  });

  it('keeps sensitive operations admin-gated or stronger', () => {
    expect(REQUIRED_ROLE_BY_CONNECTOR_PERMISSION[CONNECTOR_PERMISSIONS.rotateSecret]).toBe('admin');
    expect(REQUIRED_ROLE_BY_CONNECTOR_PERMISSION[CONNECTOR_PERMISSIONS.deleteConnector]).toBe('admin');
    expect(REQUIRED_ROLE_BY_CONNECTOR_PERMISSION[CONNECTOR_PERMISSIONS.manageRoutes]).toBe('admin');
    expect(REQUIRED_ROLE_BY_CONNECTOR_PERMISSION[CONNECTOR_PERMISSIONS.viewAudit]).toBe('security');
  });
});
