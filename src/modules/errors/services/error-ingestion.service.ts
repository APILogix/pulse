import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupingService } from './error-grouping.service.ts';
import type { ErrorRepository } from '../repositories/error.repository.ts';
import { domainEventBus } from '../../../shared/events/domain-event-bus.js';
import type { CreateErrorGroupParams, ErrorGroupEventRecord } from '../models/error-group.model.ts';
import type { UpsertErrorGroupParams } from '../repositories/error-group.repository.ts';
import type { WorkerMetrics } from '../../ingestion/workers/metrics-server.ts';

export class ErrorIngestionService {
  constructor(
    private readonly pool: Pool,
    private readonly errorGroupingService: ErrorGroupingService,
    private readonly errorRepository: ErrorRepository,
    private readonly metrics?: WorkerMetrics
  ) {}

  /**
   * Ingests a single error event transactionally.
   * Guarantees idempotency: if the event is a duplicate, the transaction is rolled back,
   * meaning group counters are not artificially inflated.
   */
  async ingestError(
    groupParams: UpsertErrorGroupParams,
    eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this.ingestErrorWithClient(client, groupParams, eventRecord);
      if (!result.inserted) {
        await client.query('ROLLBACK');
        return;
      }
      await client.query('COMMIT');
      this.publishDomainEvents(result.groupResult, eventRecord);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async ingestErrorWithClient(
    client: PoolClient,
    groupParams: UpsertErrorGroupParams,
    eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>
  ): Promise<{ inserted: boolean; groupResult: { id: string; isNew: boolean; status: string; isRegression: boolean } }> {
    const startTime = Date.now();

    // 1. Upsert group
    const t1 = Date.now();
    const groupResult = await this.errorGroupingService.handleGroup(client, groupParams);
    const t2 = Date.now();
    if (this.metrics) {
      this.metrics.recordErrorLatencies(null, t2 - t1, null, null);
    }

    // 2. Insert error event
    const fullEventRecord: ErrorGroupEventRecord = {
      ...eventRecord,
      error_group_id: groupResult.id,
    };
    const inserted = await this.errorRepository.insert(client, fullEventRecord);

    if (!inserted) {
      // If event already exists, it's a duplicate retry. The caller-owned
      // transaction must roll back to undo the group counter bump.
      if (this.metrics) this.metrics.recordErrorDuplicate();
      return { inserted: false, groupResult };
    }

    if (this.metrics) {
      this.metrics.recordErrorGroup(groupResult.isNew, groupResult.isRegression);
      this.metrics.recordErrorLatencies(null, null, Date.now() - startTime, null);
    }

    return { inserted: true, groupResult };
  }

  private publishDomainEvents(
    groupResult: { id: string; isNew: boolean; status: string; isRegression: boolean },
    eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>
  ): void {
    const eventStart = Date.now();
    // Publish internal domain events outside of transaction
    if (groupResult.isNew) {
      domainEventBus.publish('ErrorGroupCreated', {
        errorGroupId: groupResult.id,
        projectId: eventRecord.project_id,
        organizationId: eventRecord.organization_id,
        fingerprint: eventRecord.fingerprint,
        eventId: eventRecord.event_id,
      });
    } else if (groupResult.isRegression) {
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
    
    if (this.metrics) {
      this.metrics.recordErrorLatencies(null, null, null, Date.now() - eventStart);
    }
  }

  async ingestBatch(
    client: PoolClient,
    errors: Array<{ groupParams: UpsertErrorGroupParams; eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'> }>
  ): Promise<{ inserted: number; domainEvents: Array<{
    groupResult: { id: string; isNew: boolean; status: string; isRegression: boolean };
    eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>;
  }> }> {
    let inserted = 0;
    const domainEvents: Array<{
      groupResult: { id: string; isNew: boolean; status: string; isRegression: boolean };
      eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>;
    }> = [];
    for (const error of errors) {
      const result = await this.ingestErrorWithClient(client, error.groupParams, error.eventRecord);
      if (!result.inserted) {
        throw new Error('DUPLICATE_ERROR_EVENT');
      }
      inserted++;
      domainEvents.push({ groupResult: result.groupResult, eventRecord: error.eventRecord });
    }
    return { inserted, domainEvents };
  }

  publishBatchDomainEvents(events: Array<{
    groupResult: { id: string; isNew: boolean; status: string; isRegression: boolean };
    eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>;
  }>): void {
    for (const event of events) {
      this.publishDomainEvents(event.groupResult, event.eventRecord);
    }
  }
}
