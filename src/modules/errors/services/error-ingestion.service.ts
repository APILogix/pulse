import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupingService } from './error-grouping.service.ts';
import type { ErrorRepository } from '../repositories/error.repository.ts';
import { domainEventBus } from '../../../shared/events/domain-event-bus.ts';
import type { CreateErrorGroupParams, ErrorGroupEventRecord } from '../models/error-group.model.ts';

export class ErrorIngestionService {
  constructor(
    private readonly pool: Pool,
    private readonly errorGroupingService: ErrorGroupingService,
    private readonly errorRepository: ErrorRepository
  ) {}

  /**
   * Ingests a single error event transactionally.
   */
  async ingestError(
    groupParams: CreateErrorGroupParams,
    eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>
  ): Promise<void> {
    const client = await this.pool.connect();
    let errorGroupId: string;

    try {
      await client.query('BEGIN');

      // Find or create group and update stats
      errorGroupId = await this.errorGroupingService.handleGroup(client, groupParams);

      // Insert error event
      const fullEventRecord: ErrorGroupEventRecord = {
        ...eventRecord,
        error_group_id: errorGroupId,
      };
      await this.errorRepository.insert(client, fullEventRecord);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Publish internal domain event outside of transaction
    domainEventBus.publish('ErrorGrouped', {
      errorGroupId,
      eventId: eventRecord.event_id,
      projectId: eventRecord.project_id,
      organizationId: eventRecord.organization_id,
      fingerprint: eventRecord.fingerprint,
    });
  }

  /**
   * Process a batch of errors sequentially to ensure each one is transacted correctly.
   */
  async ingestBatch(
    errors: Array<{ groupParams: CreateErrorGroupParams; eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'> }>
  ): Promise<void> {
    for (const error of errors) {
      await this.ingestError(error.groupParams, error.eventRecord);
    }
  }
}
