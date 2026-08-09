import type { PoolClient } from 'pg';
import type { ErrorGroupRepository, UpsertErrorGroupParams, GroupMutationResult } from '../repositories/error-group.repository.js';

export class ErrorGroupingService {
  constructor(private readonly errorGroupRepo: ErrorGroupRepository) {}

  async handleGroup(client: PoolClient, params: UpsertErrorGroupParams): Promise<GroupMutationResult> {
    return this.errorGroupRepo.upsertGroup(client, params);
  }
}
