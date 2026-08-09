import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupingService } from './error-grouping.service.js';
import type { ErrorRepository } from '../repositories/error.repository.js';
import { domainEventBus } from '../../../shared/events/domain-event-bus.js';
import type { ErrorGroupEventRecord } from '../models/error-group.model.js';
import type { UpsertErrorGroupParams, GroupMutationResult } from '../repositories/error-group.repository.js';
import type { WorkerMetrics } from '../../ingestion/workers/metrics-server.js';

export interface IngestionResult {
  inserted: boolean;
  groupResult: GroupMutationResult | null;
}

export class ErrorIngestionService {
  constructor(
    private readonly pool: Pool,
    private readonly errorGroupingService: ErrorGroupingService,
    private readonly errorRepository: ErrorRepository,
    private readonly metrics?: WorkerMetrics,
  ) {}

  async ingestError(
    groupParams: UpsertErrorGroupParams,
    eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this.ingestErrorWithClient(client, groupParams, eventRecord);
      await client.query('COMMIT');
      if (result.inserted && result.groupResult) this.publishDomainEvents(result.groupResult, eventRecord);
    } catch (error) {
      await Promise.resolve(client.query('ROLLBACK')).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async ingestErrorWithClient(
    client: PoolClient,
    groupParams: UpsertErrorGroupParams,
    eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>,
  ): Promise<IngestionResult> {
    const startTime = Date.now();
    const inserted = await this.errorRepository.insertIfNew(client, {
      ...eventRecord,
      error_group_id: null,
    });

    if (!inserted.inserted) {
      this.metrics?.recordErrorDuplicate();
      return { inserted: false, groupResult: null };
    }

    const groupStart = Date.now();
    const groupResult = await this.errorGroupingService.handleGroup(client, groupParams);
    this.metrics?.recordErrorLatencies(null, Date.now() - groupStart, null, null);

    await this.errorRepository.attachGroup(
      client,
      eventRecord.organization_id,
      eventRecord.event_id,
      eventRecord.occurred_at,
      groupResult.id,
    );

    this.metrics?.recordErrorGroup(groupResult.isNew, groupResult.isRegression);
    this.metrics?.recordErrorLatencies(null, null, Date.now() - startTime, null);
    return { inserted: true, groupResult };
  }

  private publishDomainEvents(groupResult: GroupMutationResult, eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>): void {
    const eventStart = Date.now();
    if (groupResult.isNew) {
      domainEventBus.publish('ErrorGroupCreated', {
        errorGroupId: groupResult.id,
        projectId: eventRecord.project_id,
        organizationId: eventRecord.organization_id,
        fingerprint: eventRecord.fingerprint,
        eventId: eventRecord.event_id,
      });
    }
    if (groupResult.isRegression) {
      domainEventBus.publish('ErrorRegressed', {
        errorGroupId: groupResult.id,
        projectId: eventRecord.project_id,
        organizationId: eventRecord.organization_id,
        fingerprint: eventRecord.fingerprint,
        eventId: eventRecord.event_id,
      });
    }
    domainEventBus.publish('ErrorOccurred', {
      errorGroupId: groupResult.id,
      eventId: eventRecord.event_id,
      projectId: eventRecord.project_id,
      organizationId: eventRecord.organization_id,
      fingerprint: eventRecord.fingerprint,
    });
    this.metrics?.recordErrorLatencies(null, null, null, Date.now() - eventStart);
  }

  async ingestBatch(
    client: PoolClient,
    errors: Array<{ groupParams: UpsertErrorGroupParams; eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'> }>,
  ): Promise<{
    inserted: number;
    domainEvents: Array<{ groupResult: GroupMutationResult; eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'> }>;
  }> {
    let inserted = 0;
    const domainEvents: Array<{ groupResult: GroupMutationResult; eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'> }> = [];
    for (const error of errors) {
      const result = await this.ingestErrorWithClient(client, error.groupParams, error.eventRecord);
      if (!result.inserted || !result.groupResult) continue;
      inserted += 1;
      domainEvents.push({ groupResult: result.groupResult, eventRecord: error.eventRecord });
    }
    return { inserted, domainEvents };
  }

  publishBatchDomainEvents(events: Array<{ groupResult: GroupMutationResult; eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'> }>): void {
    for (const event of events) this.publishDomainEvents(event.groupResult, event.eventRecord);
  }
}
