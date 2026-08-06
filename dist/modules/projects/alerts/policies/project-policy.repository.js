import { pool } from '../../../../config/database.js';
export class ProjectPolicyRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async list(organizationId, projectId) {
        const result = await this.db.query(`SELECT s.id, s.organization_id, s.project_id, s.policy_id, s.state,
              s.created_at, s.updated_at,
              to_jsonb(p) || jsonb_build_object(
                'category', c.slug,
                'metricSource', COALESCE(v.definition->>'metricSource', ''),
                'expression', COALESCE(v.definition->>'expression', ''),
                'documentation', COALESCE(v.definition->>'documentation', p.description),
                'dependencies', COALESCE(v.definition->'dependencies', '[]'::jsonb)
              ) AS policy,
              to_jsonb(o) AS override
       FROM alerting_project_policy_subscriptions s
       JOIN projects project ON project.id = s.project_id AND project.org_id = s.organization_id
       JOIN alerting_policy_catalog p ON p.id = s.policy_id AND p.organization_id = s.organization_id
       JOIN alerting_policy_categories c ON c.id = p.category_id
       LEFT JOIN alerting_policy_versions v ON v.policy_id = p.id AND v.version = p.current_version
       LEFT JOIN alerting_project_policy_overrides o ON o.subscription_id = s.id AND o.organization_id = s.organization_id
       WHERE s.organization_id = $1 AND s.project_id = $2 AND s.deleted_at IS NULL
       ORDER BY p.slug`, [organizationId, projectId]);
        return result.rows;
    }
    async create(organizationId, projectId, policyId, userId) {
        const result = await this.db.query(`INSERT INTO alerting_project_policy_subscriptions
         (organization_id, project_id, policy_id, state, created_by, updated_by)
       SELECT $1, $2, p.id, 'subscribed', $4, $4
       FROM alerting_policy_catalog p
       JOIN projects project ON project.id = $2 AND project.org_id = $1
       WHERE p.id = $3 AND p.organization_id = $1
       RETURNING id, organization_id, project_id, policy_id, state, created_at, updated_at`, [organizationId, projectId, policyId, userId]);
        return result.rows[0] ?? null;
    }
    async updateState(organizationId, projectId, subscriptionId, userId, body) {
        const result = await this.db.query(`UPDATE alerting_project_policy_subscriptions
       SET state = $4, updated_by = $5, updated_at = NOW()
       WHERE organization_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL
       RETURNING id, organization_id, project_id, policy_id, state, created_at, updated_at`, [organizationId, projectId, subscriptionId, body.state, userId]);
        return result.rows[0] ?? null;
    }
    async updateOverride(organizationId, projectId, subscriptionId, userId, body) {
        const result = await this.db.query(`INSERT INTO alerting_project_policy_overrides
         (organization_id, subscription_id, threshold, cooldown_seconds, channels, severity,
          maintenance_windows, evaluation_window_seconds, environment, escalation_policy_id,
          mute_schedule, created_by, updated_by)
       SELECT $1, s.id, $5::jsonb, $6, $7::jsonb, $8::alert_severity,
              $9::jsonb, $10, $11, $12, $13::jsonb, $14, $14
       FROM alerting_project_policy_subscriptions s
       WHERE s.organization_id = $1 AND s.project_id = $2 AND s.id = $3 AND s.deleted_at IS NULL
       ON CONFLICT (subscription_id) DO UPDATE SET
         threshold = EXCLUDED.threshold,
         cooldown_seconds = EXCLUDED.cooldown_seconds,
         channels = EXCLUDED.channels,
         severity = EXCLUDED.severity,
         maintenance_windows = EXCLUDED.maintenance_windows,
         evaluation_window_seconds = EXCLUDED.evaluation_window_seconds,
         environment = EXCLUDED.environment,
         escalation_policy_id = EXCLUDED.escalation_policy_id,
         mute_schedule = EXCLUDED.mute_schedule,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING *`, [
            organizationId,
            projectId,
            subscriptionId,
            userId,
            body.threshold === undefined ? null : JSON.stringify(body.threshold),
            body.cooldownSeconds ?? null,
            body.channels === undefined ? null : JSON.stringify(body.channels),
            body.severity ?? null,
            body.maintenanceWindows === undefined ? null : JSON.stringify(body.maintenanceWindows),
            body.evaluationWindowSeconds ?? null,
            body.environment ?? null,
            body.escalationPolicyId ?? null,
            body.muteSchedule === undefined ? null : JSON.stringify(body.muteSchedule),
            userId,
        ]);
        return result.rows[0] ?? null;
    }
    async remove(organizationId, projectId, subscriptionId, userId) {
        const result = await this.db.query(`UPDATE alerting_project_policy_subscriptions
       SET state = 'archived', deleted_at = NOW(), updated_by = $4, updated_at = NOW()
       WHERE organization_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL`, [organizationId, projectId, subscriptionId, userId]);
        return (result.rowCount ?? 0) > 0;
    }
    async resolve(organizationId, projectId, policyId) {
        const result = await this.db.query(`SELECT s.id AS subscription_id, s.state, s.project_id, s.policy_id,
              p.organization_id, p.slug, p.name, p.description, c.slug AS category,
              p.severity, p.default_threshold, p.recovery_threshold, p.cooldown_seconds,
              p.evaluation_window_seconds, p.current_version, p.enabled,
              v.definition AS current_definition, to_jsonb(o) AS override
       FROM alerting_project_policy_subscriptions s
       JOIN alerting_policy_catalog p ON p.id = s.policy_id AND p.organization_id = s.organization_id
       JOIN alerting_policy_categories c ON c.id = p.category_id
       LEFT JOIN alerting_policy_versions v ON v.policy_id = p.id AND v.version = p.current_version
       LEFT JOIN alerting_project_policy_overrides o ON o.subscription_id = s.id AND o.organization_id = s.organization_id
       WHERE s.organization_id = $1 AND s.project_id = $2 AND s.policy_id = $3 AND s.deleted_at IS NULL`, [organizationId, projectId, policyId]);
        const row = result.rows[0];
        if (!row)
            return null;
        const override = row.override ?? null;
        return {
            policyId: row.policy_id,
            projectId: row.project_id,
            state: row.state,
            effectiveThreshold: override?.threshold ?? row.default_threshold,
            effectiveCooldownSeconds: override?.cooldown_seconds ?? row.cooldown_seconds,
            effectiveEvaluationWindowSeconds: override?.evaluation_window_seconds ?? row.evaluation_window_seconds,
            effectiveSeverity: override?.severity ?? row.severity,
            effectiveChannels: override?.channels ?? [],
            effectiveEscalationPolicyId: override?.escalation_policy_id ?? null,
            isOverridden: override !== null,
            overrides: override,
            basePolicy: {
                id: row.policy_id,
                organizationId: row.organization_id,
                slug: row.slug,
                name: row.name,
                description: row.description,
                category: row.category,
                severity: row.severity,
                defaultThreshold: row.default_threshold,
                recoveryThreshold: row.recovery_threshold,
                cooldownSeconds: row.cooldown_seconds,
                evaluationWindowSeconds: row.evaluation_window_seconds,
                currentVersion: row.current_version,
                enabled: row.enabled,
                currentDefinition: row.current_definition,
            },
        };
    }
}
//# sourceMappingURL=project-policy.repository.js.map