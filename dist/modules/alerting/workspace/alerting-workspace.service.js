import { pool } from '../../../config/database.js';
import { ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';
import { hasMinRole } from '../../organization/shared/types.js';
import { AlertingWorkspaceProvisioner } from './alerting-workspace.provisioner.js';
import { AlertingWorkspaceRepository } from './alerting-workspace.repository.js';
export class AlertingWorkspaceService {
    repository;
    provisioner;
    logger;
    constructor(repository = new AlertingWorkspaceRepository(), provisioner = new AlertingWorkspaceProvisioner(repository), logger) {
        this.repository = repository;
        this.provisioner = provisioner;
        this.logger = logger;
    }
    provision(client, context) {
        return this.provisioner.provision(client, context);
    }
    provisionWorkspace(context) {
        return this.provisioner.provisionWorkspace(context);
    }
    getWorkspaceSnapshot(organizationId) {
        return this.repository.getWorkspaceSnapshot(organizationId);
    }
    listPolicies(organizationId, query = {}) {
        return this.repository.listPolicies(organizationId, query);
    }
    async getPolicy(organizationId, policyId) {
        const policy = await this.repository.getPolicy(organizationId, policyId);
        if (!policy)
            throw new NotFoundError('Alerting policy');
        return policy;
    }
    async createPolicy(organizationId, actorId, input) {
        await this.requireRole(organizationId, actorId, 'admin');
        return this.repository.createPolicy(organizationId, actorId, input);
    }
    async createPolicyVersion(organizationId, actorId, policyId, definition) {
        await this.requireRole(organizationId, actorId, 'admin');
        const policy = await this.repository.createPolicyVersion(organizationId, actorId, policyId, definition);
        if (!policy)
            throw new NotFoundError('Alerting policy');
        return policy;
    }
    async updateSettings(organizationId, actorId, input) {
        await this.requireRole(organizationId, actorId, 'admin');
        const result = await this.repository.updateSettings(organizationId, input);
        if (!result)
            throw new NotFoundError('Alerting settings');
        return result;
    }
    async updateMaintenance(organizationId, actorId, input) {
        await this.requireRole(organizationId, actorId, 'admin');
        const result = await this.repository.updateMaintenance(organizationId, input);
        if (!result)
            throw new NotFoundError('Alerting maintenance configuration');
        return result;
    }
    async updateNotificationDefaults(organizationId, actorId, input) {
        await this.requireRole(organizationId, actorId, 'admin');
        const result = await this.repository.updateNotificationDefaults(organizationId, input);
        if (!result)
            throw new NotFoundError('Alerting notification defaults');
        return result;
    }
    async requireRole(organizationId, userId, required) {
        const result = await pool.query(`SELECT role, status FROM organization_members WHERE org_id = $1 AND user_id = $2 LIMIT 1`, [organizationId, userId]);
        const member = result.rows[0];
        if (!member || member.status !== 'active' || !hasMinRole(member.role, required)) {
            this.logger?.warn({ organizationId, userId, required }, 'Alerting workspace role check failed');
            throw new ForbiddenError(`Requires ${required} role or higher`);
        }
    }
}
//# sourceMappingURL=alerting-workspace.service.js.map