import type { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../../../config/database.js';
import { ProjectError, hasRequiredRole } from '../../projects/shared/utils.js';
import type { OrgRole } from '../../projects/types.js';
export {
  CONNECTOR_PERMISSIONS,
  REQUIRED_ROLE_BY_CONNECTOR_PERMISSION,
  type ConnectorPermission,
} from './permission.constants.js';
import {
  REQUIRED_ROLE_BY_CONNECTOR_PERMISSION,
  type ConnectorPermission,
} from './permission.constants.js';

function getOrgId(request: FastifyRequest): string | null {
  const params = (request.params ?? {}) as Record<string, unknown>;
  return typeof params.orgId === 'string' && params.orgId.length > 0 ? params.orgId : null;
}

export function requireConnectorPermission(permission: ConnectorPermission) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const orgId = getOrgId(request);
    const userId = request.user?.id;
    if (!orgId || !userId) {
      throw new ProjectError('INSUFFICIENT_PERMISSIONS', 'Organization context is required', 403);
    }

    const membership = await pool.query<{ role: OrgRole; is_active: boolean }>(
      `SELECT role, (status = 'active') AS is_active
       FROM organization_members
       WHERE org_id=$1 AND user_id=$2
       LIMIT 1`,
      [orgId, userId],
    );
    const row = membership.rows[0];
    const requiredRole = REQUIRED_ROLE_BY_CONNECTOR_PERMISSION[permission];
    if (!row?.is_active || !hasRequiredRole(row.role, requiredRole)) {
      throw new ProjectError(
        'INSUFFICIENT_PERMISSIONS',
        `Connector permission required: ${permission}`,
        403,
        { permission, requiredRole },
      );
    }
  };
}
