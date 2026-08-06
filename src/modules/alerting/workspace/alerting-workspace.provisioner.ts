import type { PoolClient } from 'pg';
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
}
