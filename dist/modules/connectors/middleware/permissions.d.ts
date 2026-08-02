import type { FastifyReply, FastifyRequest } from 'fastify';
export { CONNECTOR_PERMISSIONS, REQUIRED_ROLE_BY_CONNECTOR_PERMISSION, type ConnectorPermission, } from './permission.constants.js';
import { type ConnectorPermission } from './permission.constants.js';
export declare function requireConnectorPermission(permission: ConnectorPermission): (request: FastifyRequest, _reply: FastifyReply) => Promise<void>;
//# sourceMappingURL=permissions.d.ts.map