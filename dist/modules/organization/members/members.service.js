import { ForbiddenError, ValidationError, NotFoundError } from "../shared/errors.js";
import { invalidateMembershipCache } from "../../../shared/middleware/tenant.js";
import { hasMinRole } from "../shared/types.js";
export class MembersService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    hasMinRole(member, required) {
        return hasMinRole(member.role, required);
    }
    async requireMember(orgId, userId, minRole) {
        const member = await this.deps.repository.findMember(orgId, userId);
        if (!member || member.status === "removed")
            throw new ForbiddenError("Not a member of this organization");
        if (member.status === "suspended")
            throw new ForbiddenError("Your access to this organization has been suspended");
        if (minRole && !this.hasMinRole(member, minRole)) {
            throw new ForbiddenError(`Requires ${minRole} role or higher`);
        }
        return member;
    }
    async addMember(meta, orgId, userId, role, method = "api") {
        await this.deps.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "admin");
        await this.deps.enforceBillingLimit(orgId, "member");
        const existing = await this.deps.repository.findMember(orgId, userId);
        if (existing && existing.status === "active")
            throw new ValidationError("User is already an active member");
        const member = await this.deps.repository.addMember(orgId, userId, role, meta.actorUserId, method);
        invalidateMembershipCache(orgId, userId);
        await this.deps.audit(meta, { orgId, action: "member.added", entityType: "user", entityId: userId, newValues: { role } });
        return member;
    }
    async removeMember(meta, orgId, targetUserId, reason) {
        await this.deps.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "admin");
        if (meta.actorUserId === targetUserId)
            throw new ValidationError("Cannot remove yourself. Use leave organization endpoint instead.");
        const target = await this.deps.repository.findMember(orgId, targetUserId);
        if (!target)
            throw new ValidationError("User is not a member of this organization");
        if (target.role === "owner") {
            const ownerCount = await this.deps.repository.countActiveOwners(orgId);
            if (ownerCount <= 1)
                throw new ValidationError("Cannot remove the last owner of the organization");
        }
        await this.deps.repository.removeMember(orgId, targetUserId, meta.actorUserId, reason);
        invalidateMembershipCache(orgId, targetUserId);
        await this.deps.audit(meta, { orgId, action: "member.removed", entityType: "user", entityId: targetUserId, oldValues: { role: target.role } });
    }
    async suspendMember(meta, orgId, targetUserId, reason) {
        await this.deps.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "admin");
        if (meta.actorUserId === targetUserId)
            throw new ValidationError("Cannot suspend yourself");
        const target = await this.deps.repository.findMember(orgId, targetUserId);
        if (!target)
            throw new ValidationError("User is not a member of this organization");
        if (target.role === "owner")
            throw new ValidationError("Cannot suspend an owner");
        await this.deps.repository.suspendMember(orgId, targetUserId, meta.actorUserId, reason);
        invalidateMembershipCache(orgId, targetUserId);
        await this.deps.audit(meta, { orgId, action: "member.suspended", entityType: "user", entityId: targetUserId });
    }
    async reactivateMember(meta, orgId, targetUserId) {
        await this.deps.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "admin");
        await this.deps.enforceBillingLimit(orgId, "member");
        await this.deps.repository.reactivateMember(orgId, targetUserId);
        invalidateMembershipCache(orgId, targetUserId);
        await this.deps.audit(meta, { orgId, action: "member.reactivated", entityType: "user", entityId: targetUserId });
    }
    async updateMemberRole(meta, orgId, targetUserId, newRole) {
        await this.deps.requireMutableOrg(orgId);
        await this.requireMember(orgId, meta.actorUserId, "owner"); // Only owners can change roles
        if (meta.actorUserId === targetUserId)
            throw new ValidationError("Cannot change your own role");
        const target = await this.deps.repository.findMember(orgId, targetUserId);
        if (!target)
            throw new ValidationError("User is not a member of this organization");
        if (target.role === "owner" && newRole !== "owner") {
            const ownerCount = await this.deps.repository.countActiveOwners(orgId);
            if (ownerCount <= 1)
                throw new ValidationError("Cannot demote the last owner of the organization");
        }
        await this.deps.repository.updateMemberRole(orgId, targetUserId, newRole);
        invalidateMembershipCache(orgId, targetUserId);
        await this.deps.audit(meta, { orgId, action: "member.role_updated", entityType: "user", entityId: targetUserId, oldValues: { role: target.role }, newValues: { role: newRole } });
    }
    async listMembers(orgId, userId, q, filters) {
        await this.requireMember(orgId, userId);
        const result = await this.deps.repository.listMembers(orgId, q, filters);
        return {
            data: result.data.map(m => ({ id: m.id, userId: m.user_id, email: m.email, fullName: m.full_name, role: m.role, status: m.status, joinedAt: m.joined_at, lastActiveAt: m.last_active_at, createdAt: m.created_at })),
            meta: result.meta
        };
    }
    async getMember(orgId, actorUserId, targetUserId) {
        await this.requireMember(orgId, actorUserId);
        const m = await this.deps.repository.findMember(orgId, targetUserId);
        if (!m)
            throw new NotFoundError("Member");
        return { id: m.id, userId: m.user_id, email: m.email, fullName: m.full_name, role: m.role, status: m.status, joinedAt: m.joined_at, lastActiveAt: m.last_active_at, createdAt: m.created_at };
    }
    async countOwners(orgId) {
        return this.deps.repository.countActiveOwners(orgId);
    }
    async leaveOrganization(meta, orgId) {
        await this.deps.requireMutableOrg(orgId);
        const member = await this.requireMember(orgId, meta.actorUserId);
        if (member.role === "owner") {
            const ownerCount = await this.deps.repository.countActiveOwners(orgId);
            if (ownerCount <= 1)
                throw new ValidationError("Cannot leave organization as the last owner");
        }
        await this.deps.repository.removeMember(orgId, meta.actorUserId, meta.actorUserId, "self-leave");
        invalidateMembershipCache(orgId, meta.actorUserId);
        await this.deps.audit(meta, { orgId, action: "member.left", entityType: "user", entityId: meta.actorUserId });
    }
}
//# sourceMappingURL=members.service.js.map