import type { FastifyBaseLogger } from 'fastify';
import type { PoolClient } from 'pg';
import { pool } from '../../../config/database.js';
import { ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';
import { hasMinRole, type OrgRole } from '../../organization/shared/types.js';
import { AlertingWorkspaceProvisioner } from './alerting-workspace.provisioner.js';
import type { AlertingProvisioningContext, JsonObject } from './alerting-workspace.types.js';
import { AlertingWorkspaceRepository } from './alerting-workspace.repository.js';

export class AlertingWorkspaceService {
  constructor(
    private readonly repository = new AlertingWorkspaceRepository(),
    private readonly provisioner = new AlertingWorkspaceProvisioner(repository),
    private readonly logger?: FastifyBaseLogger,
  ) {}

  provision(client: PoolClient, context: AlertingProvisioningContext) {
    return this.provisioner.provision(client, context);
  }

  getWorkspaceSnapshot(organizationId: string) {
    return this.repository.getWorkspaceSnapshot(organizationId);
  }

  listPolicies(organizationId: string, query: { limit?: number; offset?: number } = {}) {
    return this.repository.listPolicies(organizationId, query);
  }

  async getPolicy(organizationId: string, policyId: string) {
    const policy = await this.repository.getPolicy(organizationId, policyId);
    if (!policy) throw new NotFoundError('Alerting policy');
    return policy;
  }

  async createPolicy(organizationId: string, actorId: string, input: {
    slug: string; name: string; description: string; category: string; severity: string;
    metricSource: string; expression: string; defaultThreshold: JsonObject;
    recoveryThreshold: JsonObject; cooldownSeconds: number; evaluationWindowSeconds: number;
    documentation: string; dependencies: string[];
  }) {
    await this.requireRole(organizationId, actorId, 'admin');
    return this.repository.createPolicy(organizationId, actorId, input);
  }

  async createPolicyVersion(organizationId: string, actorId: string, policyId: string, definition: JsonObject) {
    await this.requireRole(organizationId, actorId, 'admin');
    const policy = await this.repository.createPolicyVersion(organizationId, actorId, policyId, definition);
    if (!policy) throw new NotFoundError('Alerting policy');
    return policy;
  }

  async updateSettings(organizationId: string, actorId: string, input: Record<string, unknown>) {
    await this.requireRole(organizationId, actorId, 'admin');
    const result = await this.repository.updateSettings(organizationId, input);
    if (!result) throw new NotFoundError('Alerting settings');
    return result;
  }

  async updateMaintenance(organizationId: string, actorId: string, input: Record<string, unknown>) {
    await this.requireRole(organizationId, actorId, 'admin');
    const result = await this.repository.updateMaintenance(organizationId, input);
    if (!result) throw new NotFoundError('Alerting maintenance configuration');
    return result;
  }

  async updateNotificationDefaults(organizationId: string, actorId: string, input: Record<string, unknown>) {
    await this.requireRole(organizationId, actorId, 'admin');
    const result = await this.repository.updateNotificationDefaults(organizationId, input);
    if (!result) throw new NotFoundError('Alerting notification defaults');
    return result;
  }

  private async requireRole(organizationId: string, userId: string, required: OrgRole): Promise<void> {
    const result = await pool.query<{ role: OrgRole; status: string }>(
      `SELECT role, status FROM organization_members WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
      [organizationId, userId],
    );
    const member = result.rows[0];
    if (!member || member.status !== 'active' || !hasMinRole(member.role, required)) {
      this.logger?.warn({ organizationId, userId, required }, 'Alerting workspace role check failed');
      throw new ForbiddenError(`Requires ${required} role or higher`);
    }
  }
}
