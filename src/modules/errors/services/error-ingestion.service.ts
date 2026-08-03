import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupingService } from './error-grouping.service.ts';
import type { ErrorRepository } from '../repositories/error.repository.ts';
import { domainEventBus } from '../../../shared/events/domain-event-bus.ts';
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
    let groupResult: { id: string; isNew: boolean; status: string; isRegression: boolean };

    const startTime = Date.now();
    try {
      await client.query('BEGIN');

      // 1. Upsert group
      const t1 = Date.now();
      groupResult = await this.errorGroupingService.handleGroup(client, groupParams);
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
        // If event already exists, it's a duplicate retry. Rollback to undo the group counter bump.
        await client.query('ROLLBACK');
        if (this.metrics) this.metrics.recordErrorDuplicate();
        return;
      }

      await client.query('COMMIT');
      
      const t3 = Date.now();
      if (this.metrics) {
        this.metrics.recordErrorGroup(groupResult.isNew, groupResult.isRegression);
        this.metrics.recordErrorLatencies(null, null, t3 - startTime, null);
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

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
    errors: Array<{ groupParams: UpsertErrorGroupParams; eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'> }>
  ): Promise<void> {
    for (const error of errors) {
      await this.ingestError(error.groupParams, error.eventRecord);
    }
  }
}
