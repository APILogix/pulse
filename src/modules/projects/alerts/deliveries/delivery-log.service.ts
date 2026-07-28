/**
 * Project alert delivery + dead-letter service.
 *
 * Every operation is authorised through requireProjectAccess. Reads require
 * VIEWER; reprocess/discard/purge mutate delivery state and require EDITOR.
 */
import type { FastifyBaseLogger } from "fastify";
import { BaseProjectService } from "../../shared/base.service.js";
import { ProjectMemberRole } from "../../types.js";
import type { DeliveryLogRepository, DeliveryLogRow } from "./delivery-log.repository.js";

export interface AlertDeliveryDto {
  id: string;
  timestamp: number;
  routeName: string;
  connectorType: string;
  status: string;
  severity: string;
  attempts: number;
  latency: number | null;
}

export interface DeadLetterDto {
  id: string;
  timestamp: number;
  routeName: string;
  target: string;
  reason: string;
  payloadSize: string;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return "0kb";
  const kb = bytes / 1024;
  if (kb < 1) return `${bytes}b`;
  if (kb < 1024) return `${kb.toFixed(1)}kb`;
  return `${(kb / 1024).toFixed(1)}mb`;
}

export class DeliveryLogService {
  constructor(
    private readonly repository: DeliveryLogRepository,
    private readonly base: BaseProjectService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  private toDeliveryDto(row: DeliveryLogRow): AlertDeliveryDto {
    return {
      id: row.id,
      timestamp: row.created_at.getTime(),
      routeName: row.connector_name ?? row.notification_type,
      connectorType: row.connector_provider ?? "unknown",
      status: row.status,
      severity: row.severity,
      attempts: row.attempts,
      latency: row.delivery_latency_ms,
    };
  }

  private toDeadLetterDto(row: DeliveryLogRow): DeadLetterDto {
    return {
      id: row.id,
      timestamp: row.created_at.getTime(),
      routeName: row.connector_name ?? row.notification_type,
      target: row.connector_provider ?? "unknown",
      reason: row.error_message ?? "Delivery failed after maximum retries",
      payloadSize: formatBytes(row.payload_size_bytes),
    };
  }

  async listDeliveries(
    orgId: string,
    projectId: string,
    userId: string,
    filters: { status?: string | undefined; severity?: string | undefined; limit: number; offset: number },
  ): Promise<{ data: AlertDeliveryDto[]; total: number }> {
    await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    const result = await this.repository.listDeliveries(orgId, projectId, filters);
    return { data: result.data.map((row) => this.toDeliveryDto(row)), total: result.total };
  }

  async listDeadLetters(
    orgId: string,
    projectId: string,
    userId: string,
    filters: { limit: number; offset: number },
  ): Promise<{ data: DeadLetterDto[]; total: number }> {
    await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    const result = await this.repository.listDeadLetters(orgId, projectId, filters);
    return { data: result.data.map((row) => this.toDeadLetterDto(row)), total: result.total };
  }

  async reprocessDeadLetter(
    orgId: string,
    projectId: string,
    userId: string,
    deliveryId: string,
  ): Promise<boolean> {
    await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.DEVELOPER);
    const ok = await this.repository.reprocessDeadLetter(orgId, projectId, deliveryId);
    this.logger.info({ orgId, projectId, deliveryId, ok }, "Reprocessed dead-letter delivery");
    return ok;
  }

  async reprocessAll(orgId: string, projectId: string, userId: string): Promise<number> {
    await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.DEVELOPER);
    const count = await this.repository.reprocessAll(orgId, projectId);
    this.logger.info({ orgId, projectId, count }, "Reprocessed all dead-letter deliveries");
    return count;
  }

  async discardDeadLetter(
    orgId: string,
    projectId: string,
    userId: string,
    deliveryId: string,
  ): Promise<boolean> {
    await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.DEVELOPER);
    const ok = await this.repository.discardDeadLetter(orgId, projectId, deliveryId);
    this.logger.info({ orgId, projectId, deliveryId, ok }, "Discarded dead-letter delivery");
    return ok;
  }

  async purgeQueue(orgId: string, projectId: string, userId: string): Promise<number> {
    await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.DEVELOPER);
    const count = await this.repository.purgeQueue(orgId, projectId);
    this.logger.info({ orgId, projectId, count }, "Purged dead-letter queue");
    return count;
  }
}
