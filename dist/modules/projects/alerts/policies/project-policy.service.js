import { ProjectMemberRole } from '../../core/project.types.js';
import { BaseProjectService } from '../../shared/base.service.js';
import { ProjectError } from '../../shared/utils.js';
import { ProjectPolicyRepository } from './project-policy.repository.js';
export class ProjectPolicyService {
    repository;
    projectAccess;
    logger;
    constructor(repository, projectAccess, logger) {
        this.repository = repository;
        this.projectAccess = projectAccess;
        this.logger = logger;
    }
    async list(organizationId, projectId, userId) {
        await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.VIEWER);
        return this.repository.list(organizationId, projectId);
    }
    async subscribe(organizationId, projectId, meta, body) {
        const userId = meta.actorUserId;
        await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.ADMIN);
        let subscription;
        try {
            subscription = await this.repository.create(organizationId, projectId, body.policyId, userId);
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && error.code === '23505') {
                throw new ProjectError('POLICY_SUBSCRIPTION_EXISTS', 'Project is already subscribed to this alerting policy', 409);
            }
            throw error;
        }
        if (!subscription)
            throw new ProjectError('POLICY_NOT_FOUND', 'Alerting policy not found for this organization', 404);
        this.logger.info({ organizationId, projectId, policyId: body.policyId, userId }, 'Project subscribed to alerting policy');
        await this.projectAccess.audit(meta, { orgId: organizationId, projectId, action: 'alerting.policy_subscribed', entityType: 'alerting_policy_subscription', entityId: subscription.id, newValues: { policyId: body.policyId, state: subscription.state } });
        return subscription;
    }
    async updateState(organizationId, projectId, meta, subscriptionId, body) {
        const userId = meta.actorUserId;
        await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.ADMIN);
        const subscription = await this.repository.updateState(organizationId, projectId, subscriptionId, userId, body);
        if (!subscription)
            throw new ProjectError('SUBSCRIPTION_NOT_FOUND', 'Alerting policy subscription not found', 404);
        await this.projectAccess.audit(meta, { orgId: organizationId, projectId, action: 'alerting.policy_subscription_state_updated', entityType: 'alerting_policy_subscription', entityId: subscription.id, newValues: { state: subscription.state } });
        return subscription;
    }
    async updateOverride(organizationId, projectId, meta, subscriptionId, body) {
        const userId = meta.actorUserId;
        await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.ADMIN);
        const override = await this.repository.updateOverride(organizationId, projectId, subscriptionId, userId, body);
        if (!override)
            throw new ProjectError('SUBSCRIPTION_NOT_FOUND', 'Alerting policy subscription not found', 404);
        await this.projectAccess.audit(meta, { orgId: organizationId, projectId, action: 'alerting.policy_override_updated', entityType: 'alerting_policy_override', entityId: override.id, newValues: { subscriptionId } });
        return override;
    }
    async remove(organizationId, projectId, meta, subscriptionId) {
        const userId = meta.actorUserId;
        await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.ADMIN);
        const removed = await this.repository.remove(organizationId, projectId, subscriptionId, userId);
        if (!removed)
            throw new ProjectError('SUBSCRIPTION_NOT_FOUND', 'Alerting policy subscription not found', 404);
        await this.projectAccess.audit(meta, { orgId: organizationId, projectId, action: 'alerting.policy_unsubscribed', entityType: 'alerting_policy_subscription', entityId: subscriptionId });
    }
    async resolve(organizationId, projectId, policyId, userId) {
        await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.VIEWER);
        const effective = await this.repository.resolve(organizationId, projectId, policyId);
        if (!effective)
            throw new ProjectError('EFFECTIVE_POLICY_NOT_FOUND', 'Project is not subscribed to this alerting policy', 404);
        return effective;
    }
    async listEffective(organizationId, projectId, userId) {
        await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.VIEWER);
        const subscriptions = await this.repository.list(organizationId, projectId);
        const effective = [];
        for (const subscription of subscriptions) {
            const resolved = await this.repository.resolve(organizationId, projectId, subscription.policy_id);
            if (resolved)
                effective.push(resolved);
        }
        return effective;
    }
}
//# sourceMappingURL=project-policy.service.js.map