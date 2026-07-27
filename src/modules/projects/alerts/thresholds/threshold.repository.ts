import type { Pool } from "pg";
import { pool } from "../../../../config/database.js";
import { ProjectError } from "../../shared/utils.js";
import type {
  CreateThresholdBody,
  ListThresholdsQuery,
  ProjectAlertThreshold,
  ProjectAlertThresholdRow,
  UpdateThresholdBody,
} from "./threshold.types.js";

const THRESHOLD_COLUMNS = `
  id, organization_id, project_id, environment_id, threshold_key,
  metric_name, metric_source, category, severity, comparison_operator,
  threshold_value, threshold_unit, evaluation_window_minutes, cooldown_minutes,
  consecutive_breaches, enabled, notify_on_recovery, last_triggered_at,
  last_recovered_at, created_by, updated_by, created_at, updated_at,
  deleted_at, version
`;

const NOT_FOUND = () => new ProjectError(
  "ALERT_THRESHOLD_NOT_FOUND",
  "Alert threshold not found",
  404,
);

export class ThresholdRepository {
  constructor(private readonly db: Pool = pool) {}

  async list(
    organizationId: string,
    projectId: string,
    query: ListThresholdsQuery,
  ): Promise<{ thresholds: ProjectAlertThreshold[]; total: number }> {
    const params: unknown[] = [organizationId, projectId];
    const where = ["organization_id = $1", "project_id = $2", "deleted_at IS NULL"];

    if (query.environmentId !== undefined) {
      if (query.environmentId === null) where.push("environment_id IS NULL");
      else {
        params.push(query.environmentId);
        where.push(`environment_id = $${params.length}`);
      }
    }
    if (query.enabled !== undefined) {
      params.push(query.enabled);
      where.push(`enabled = $${params.length}`);
    }
    for (const [column, value] of [
      ["category", query.category],
      ["severity", query.severity],
      ["metric_name", query.metricName],
    ] as const) {
      if (value !== undefined) {
        params.push(value);
        where.push(`${column} = $${params.length}`);
      }
    }

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM project_alert_thresholds WHERE ${where.join(" AND ")}`,
      params,
    );
    const sortColumns = {
      created_at: "created_at",
      updated_at: "updated_at",
      threshold_key: "threshold_key",
      metric_name: "metric_name",
    } as const;
    const sortColumn = sortColumns[query.sortBy];
    const sortOrder = query.sortOrder === "asc" ? "ASC" : "DESC";
    const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
    params.push(query.limit, offset);

    const result = await this.db.query<ProjectAlertThresholdRow>(
      `SELECT ${THRESHOLD_COLUMNS}
         FROM project_alert_thresholds
        WHERE ${where.join(" AND ")}
        ORDER BY ${sortColumn} ${sortOrder}, id ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      thresholds: result.rows.map((row) => this.mapThreshold(row)),
      total: Number.parseInt(countResult.rows[0]?.count ?? "0", 10),
    };
  }

  async findById(
    organizationId: string,
    projectId: string,
    thresholdId: string,
  ): Promise<ProjectAlertThreshold | null> {
    const result = await this.db.query<ProjectAlertThresholdRow>(
      `SELECT ${THRESHOLD_COLUMNS}
         FROM project_alert_thresholds
        WHERE organization_id = $1 AND project_id = $2 AND id = $3
          AND deleted_at IS NULL
        LIMIT 1`,
      [organizationId, projectId, thresholdId],
    );
    const row = result.rows[0];
    return row ? this.mapThreshold(row) : null;
  }

  async findEnabled(
    organizationId: string,
    projectId: string,
    environmentId?: string | null,
  ): Promise<ProjectAlertThreshold[]> {
    const params: unknown[] = [organizationId, projectId];
    let environmentClause = "";
    if (environmentId === null) environmentClause = " AND environment_id IS NULL";
    else if (environmentId !== undefined) {
      params.push(environmentId);
      environmentClause = ` AND (environment_id IS NULL OR environment_id = $${params.length})`;
    }
    const result = await this.db.query<ProjectAlertThresholdRow>(
      `SELECT ${THRESHOLD_COLUMNS}
         FROM project_alert_thresholds
        WHERE organization_id = $1 AND project_id = $2
          AND enabled = TRUE AND deleted_at IS NULL${environmentClause}
        ORDER BY threshold_key ASC, id ASC`,
      params,
    );
    return result.rows.map((row) => this.mapThreshold(row));
  }

  async create(
    organizationId: string,
    projectId: string,
    actorUserId: string,
    body: CreateThresholdBody,
  ): Promise<ProjectAlertThreshold> {
    return this.withConflictMapping(async () => {
      const result = await this.db.query<ProjectAlertThresholdRow>(
        `INSERT INTO project_alert_thresholds (
           organization_id, project_id, environment_id, threshold_key,
           metric_name, metric_source, category, severity, comparison_operator,
           threshold_value, threshold_unit, evaluation_window_minutes,
           cooldown_minutes, consecutive_breaches, enabled, notify_on_recovery,
           created_by, updated_by, version
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           $13, $14, $15, $16, $17, $17, 1
         ) RETURNING ${THRESHOLD_COLUMNS}`,
        [
          organizationId,
          projectId,
          body.environmentId ?? null,
          body.thresholdKey,
          body.metricName,
          body.metricSource,
          body.category,
          body.severity,
          body.comparisonOperator,
          body.thresholdValue,
          body.thresholdUnit,
          body.evaluationWindowMinutes,
          body.cooldownMinutes,
          body.consecutiveBreaches,
          body.enabled,
          body.notifyOnRecovery,
          actorUserId,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new ProjectError("ALERT_THRESHOLD_CREATE_FAILED", "Alert threshold was not created", 500);
      return this.mapThreshold(row);
    });
  }

  async update(
    organizationId: string,
    projectId: string,
    thresholdId: string,
    actorUserId: string,
    body: UpdateThresholdBody,
  ): Promise<ProjectAlertThreshold> {
    const assignments: string[] = [];
    const values: unknown[] = [organizationId, projectId, thresholdId];
    const add = (column: string, value: unknown): void => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    if (body.environmentId !== undefined) add("environment_id", body.environmentId);
    if (body.thresholdKey !== undefined) add("threshold_key", body.thresholdKey);
    if (body.metricName !== undefined) add("metric_name", body.metricName);
    if (body.metricSource !== undefined) add("metric_source", body.metricSource);
    if (body.category !== undefined) add("category", body.category);
    if (body.severity !== undefined) add("severity", body.severity);
    if (body.comparisonOperator !== undefined) add("comparison_operator", body.comparisonOperator);
    if (body.thresholdValue !== undefined) add("threshold_value", body.thresholdValue);

    if (body.thresholdUnit !== undefined) add("threshold_unit", body.thresholdUnit);
    if (body.evaluationWindowMinutes !== undefined) add("evaluation_window_minutes", body.evaluationWindowMinutes);
    if (body.cooldownMinutes !== undefined) add("cooldown_minutes", body.cooldownMinutes);
    if (body.consecutiveBreaches !== undefined) add("consecutive_breaches", body.consecutiveBreaches);
    if (body.enabled !== undefined) add("enabled", body.enabled);
    if (body.notifyOnRecovery !== undefined) add("notify_on_recovery", body.notifyOnRecovery);

    values.push(actorUserId);
    assignments.push(`updated_by = $${values.length}`, "updated_at = NOW()", "version = version + 1");

    return this.withConflictMapping(async () => {
      const result = await this.db.query<ProjectAlertThresholdRow>(
        `UPDATE project_alert_thresholds
            SET ${assignments.join(", ")}
          WHERE organization_id = $1 AND project_id = $2 AND id = $3
            AND deleted_at IS NULL
          RETURNING ${THRESHOLD_COLUMNS}`,
        values,
      );
      const row = result.rows[0];
      if (!row) throw NOT_FOUND();
      return this.mapThreshold(row);
    });
  }

  async toggle(
    organizationId: string,
    projectId: string,
    thresholdId: string,
    actorUserId: string,
    enabled: boolean,
  ): Promise<ProjectAlertThreshold> {
    const result = await this.db.query<ProjectAlertThresholdRow>(
      `UPDATE project_alert_thresholds
          SET enabled = $4, updated_by = $5, updated_at = NOW(), version = version + 1
        WHERE organization_id = $1 AND project_id = $2 AND id = $3
          AND deleted_at IS NULL
        RETURNING ${THRESHOLD_COLUMNS}`,
      [organizationId, projectId, thresholdId, enabled, actorUserId],
    );
    const row = result.rows[0];
    if (!row) throw NOT_FOUND();
    return this.mapThreshold(row);
  }

  async delete(
    organizationId: string,
    projectId: string,
    thresholdId: string,
    actorUserId: string,
  ): Promise<ProjectAlertThreshold> {
    const result = await this.db.query<ProjectAlertThresholdRow>(
      `UPDATE project_alert_thresholds
          SET deleted_at = NOW(), updated_by = $4, updated_at = NOW(), version = version + 1
        WHERE organization_id = $1 AND project_id = $2 AND id = $3
          AND deleted_at IS NULL
        RETURNING ${THRESHOLD_COLUMNS}`,
      [organizationId, projectId, thresholdId, actorUserId],
    );
    const row = result.rows[0];
    if (!row) throw NOT_FOUND();
    return this.mapThreshold(row);
  }

  async markTriggered(
    organizationId: string,
    projectId: string,
    thresholdId: string,
    triggeredAt: Date,
    updatedBy: string | null = null,
  ): Promise<ProjectAlertThreshold> {
    return this.markEvaluationTimestamp(
      organizationId,
      projectId,
      thresholdId,
      "last_triggered_at",
      triggeredAt,
      updatedBy,
    );
  }

  async markRecovered(
    organizationId: string,
    projectId: string,
    thresholdId: string,
    recoveredAt: Date,
    updatedBy: string | null = null,
  ): Promise<ProjectAlertThreshold> {
    return this.markEvaluationTimestamp(
      organizationId,
      projectId,
      thresholdId,
      "last_recovered_at",
      recoveredAt,
      updatedBy,
    );
  }

  private async markEvaluationTimestamp(
    organizationId: string,
    projectId: string,
    thresholdId: string,
    column: "last_triggered_at" | "last_recovered_at",
    occurredAt: Date,
    updatedBy: string | null,
  ): Promise<ProjectAlertThreshold> {
    const result = await this.db.query<ProjectAlertThresholdRow>(
      `UPDATE project_alert_thresholds
          SET ${column} = $4, updated_by = $5, updated_at = NOW(), version = version + 1
        WHERE organization_id = $1 AND project_id = $2 AND id = $3
          AND deleted_at IS NULL
        RETURNING ${THRESHOLD_COLUMNS}`,
      [organizationId, projectId, thresholdId, occurredAt, updatedBy],
    );
    const row = result.rows[0];
    if (!row) throw NOT_FOUND();
    return this.mapThreshold(row);
  }

  private async withConflictMapping<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if ((error as { code?: unknown }).code === "23505") {
        throw new ProjectError(
          "ALERT_THRESHOLD_CONFLICT",
          "An active threshold with this key already exists for the environment",
          409,
        );
      }
      throw error;
    }
  }

  private mapThreshold(row: ProjectAlertThresholdRow): ProjectAlertThreshold {
    const thresholdValue = typeof row.threshold_value === "number"
      ? row.threshold_value
      : Number(row.threshold_value);
    if (!Number.isFinite(thresholdValue)) {
      throw new ProjectError(
        "ALERT_THRESHOLD_INVALID_VALUE",
        "Stored alert threshold value is not finite",
        500,
      );
    }
    return {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      environmentId: row.environment_id,
      thresholdKey: row.threshold_key,
      metricName: row.metric_name,
      metricSource: row.metric_source,
      category: row.category,
      severity: row.severity,
      comparisonOperator: row.comparison_operator,
      thresholdValue,
      thresholdUnit: row.threshold_unit,
      evaluationWindowMinutes: row.evaluation_window_minutes,
      cooldownMinutes: row.cooldown_minutes,
      consecutiveBreaches: row.consecutive_breaches,
      enabled: row.enabled,
      notifyOnRecovery: row.notify_on_recovery,
      lastTriggeredAt: row.last_triggered_at,
      lastRecoveredAt: row.last_recovered_at,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      version: row.version,
    };
  }
}