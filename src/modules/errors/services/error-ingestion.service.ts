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

type ErrorBatchItem = {
  groupParams: UpsertErrorGroupParams;
  eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>;
};

function errorRecordKey(record: Pick<ErrorGroupEventRecord, 'organization_id' | 'event_id' | 'occurred_at'>): string {
  return `${record.organization_id}\u0000${record.event_id}\u0000${record.occurred_at.getTime()}`;
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
    const insertStart = Date.now();
    const inserted = await this.errorRepository.insertIfNew(client, {
      ...eventRecord,
      error_group_id: null,
    });
    this.metrics?.recordStage('error_insert_row', 'error', Date.now() - insertStart);

    if (!inserted.inserted) {
      this.metrics?.recordErrorDuplicate();
      this.metrics?.recordStage('error_event_total', 'error', Date.now() - startTime);
      return { inserted: false, groupResult: null };
    }

    const groupStart = Date.now();
    const groupResult = await this.errorGroupingService.handleGroup(client, groupParams);
    const groupingMs = Date.now() - groupStart;
    this.metrics?.recordErrorLatencies(null, groupingMs, null, null);
    this.metrics?.recordStage('error_group_upsert', 'error', groupingMs);

    const attachStart = Date.now();
    await this.errorRepository.attachGroup(
      client,
      eventRecord.organization_id,
      eventRecord.event_id,
      eventRecord.occurred_at,
      groupResult.id,
    );
    this.metrics?.recordStage('error_group_attach', 'error', Date.now() - attachStart);

    this.metrics?.recordErrorGroup(groupResult.isNew, groupResult.isRegression);
    const totalMs = Date.now() - startTime;
    this.metrics?.recordErrorLatencies(null, null, totalMs, null);
    this.metrics?.recordStage('error_event_total', 'error', totalMs);
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
    errors: ErrorBatchItem[],
  ): Promise<{
    inserted: number;
    domainEvents: Array<{ groupResult: GroupMutationResult; eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'> }>;
  }> {
    const batchStart = Date.now();
    const domainEvents: Array<{ groupResult: GroupMutationResult; eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'> }> = [];
    if (errors.length === 0) {
      this.metrics?.recordStage('error_batch_loop', 'error', Date.now() - batchStart);
      return { inserted: 0, domainEvents };
    }

    const insertStart = Date.now();
    const insertedRows = await this.errorRepository.insertManyIfNew(
      client,
      errors.map(({ eventRecord }) => ({ ...eventRecord, error_group_id: null })),
    );
    this.metrics?.recordStage('error_bulk_insert', 'error', Date.now() - insertStart);

    const insertedByKey = new Map<string, number>();
    for (const row of insertedRows) {
      const key = `${row.organizationId}\u0000${row.eventId}\u0000${row.occurredAt.getTime()}`;
      insertedByKey.set(key, (insertedByKey.get(key) ?? 0) + 1);
    }

    const insertedErrors: ErrorBatchItem[] = [];
    for (const error of errors) {
      const eventStart = Date.now();
      const key = errorRecordKey(error.eventRecord);
      const remaining = insertedByKey.get(key) ?? 0;
      if (remaining <= 0) {
        this.metrics?.recordErrorDuplicate();
        this.metrics?.recordStage('error_event_total', 'error', Date.now() - eventStart);
        continue;
      }
      if (remaining === 1) insertedByKey.delete(key);
      else insertedByKey.set(key, remaining - 1);
      insertedErrors.push(error);
      this.metrics?.recordStage('error_event_total', 'error', Date.now() - eventStart);
    }

    const attachments: Array<{
      organizationId: string;
      eventId: string;
      occurredAt: Date;
      groupId: string;
    }> = [];
    if (insertedErrors.length > 0) {
      const groupStart = Date.now();
      let groupResults: Array<{ inputIndex: number; result: GroupMutationResult }>;
      try {
        groupResults = await this.errorGroupingService.handleGroupsBatch(
          client,
          insertedErrors.map((error, inputIndex) => ({
            ...error.groupParams,
            inputIndex,
          })),
        );
      } catch (err) {
        if (!(err instanceof Error) || err.message !== 'BULK_ERROR_GROUP_MERGED_GROUP_FALLBACK_REQUIRED') throw err;
        groupResults = [];
        for (const [inputIndex, error] of insertedErrors.entries()) {
          groupResults.push({
            inputIndex,
            result: await this.errorGroupingService.handleGroup(client, error.groupParams),
          });
        }
      }
      const groupingMs = Date.now() - groupStart;
      this.metrics?.recordErrorLatencies(null, groupingMs, null, null);
      this.metrics?.recordStage('error_group_upsert', 'error', groupingMs);

      const groupsByInput = new Map(groupResults.map((group) => [group.inputIndex, group.result]));
      for (const [inputIndex, error] of insertedErrors.entries()) {
        const groupResult = groupsByInput.get(inputIndex);
        if (!groupResult) throw new Error('ERROR_GROUP_BATCH_RESULT_MISSING');
        attachments.push({
          organizationId: error.eventRecord.organization_id,
          eventId: error.eventRecord.event_id,
          occurredAt: error.eventRecord.occurred_at,
          groupId: groupResult.id,
        });
        this.metrics?.recordErrorGroup(groupResult.isNew, groupResult.isRegression);
        domainEvents.push({ groupResult, eventRecord: error.eventRecord });
      }
    }
    if (attachments.length > 0) {
      const attachStart = Date.now();
      await this.errorRepository.attachGroups(client, attachments);
      this.metrics?.recordStage('error_group_attach', 'error', Date.now() - attachStart);
    }
    this.metrics?.recordStage('error_batch_loop', 'error', Date.now() - batchStart);
    return { inserted: insertedRows.length, domainEvents };
  }

  publishBatchDomainEvents(events: Array<{ groupResult: GroupMutationResult; eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'> }>): void {
    for (const event of events) this.publishDomainEvents(event.groupResult, event.eventRecord);
  }
}
