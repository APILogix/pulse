import type { PoolClient } from 'pg';
import type { ErrorGroupRepository } from '../repositories/error-group.repository.ts';
import type { CreateErrorGroupParams } from '../models/error-group.model.ts';

export class ErrorGroupingService {
  constructor(private readonly errorGroupRepo: ErrorGroupRepository) {}

  /**
   * Finds or creates an error group, updates statistics and detects regressions.
   * This logic is largely delegated to the atomic SQL in the repository.
   * Must be called within an active transaction.
   */
  async handleGroup(
    client: PoolClient,
    params: CreateErrorGroupParams
  ): Promise<{ id: string; isNew: boolean; status: string; isRegression: boolean; }> {
    // The repository method upsertGroup handles:
    // 1. Finding or creating the group atomically.
    // 2. Updating occurrence counters and last_seen_at.
    // 3. Detecting regressions (if status == 'RESOLVED', changes to 'REGRESSED').
    return await this.errorGroupRepo.upsertGroup(client, params);
  }
}
