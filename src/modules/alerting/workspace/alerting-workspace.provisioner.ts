import type { PoolClient } from 'pg';
import { pool } from '../../../config/database.js';
import { AlertingWorkspaceRepository } from './alerting-workspace.repository.js';
import type {
  AlertingProvisioningContext,
  AlertingProvisioningSummary,
} from './alerting-workspace.types.js';

export class AlertingWorkspaceProvisioner {
  constructor(private readonly repository = new AlertingWorkspaceRepository()) {}

  provision(
    client: PoolClient,
    context: AlertingProvisioningContext,
  ): Promise<AlertingProvisioningSummary> {
    return this.repository.provision(client, context);
  }

  async provisionWorkspace(
    context: AlertingProvisioningContext,
  ): Promise<AlertingProvisioningSummary> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this.repository.provision(client, context);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

