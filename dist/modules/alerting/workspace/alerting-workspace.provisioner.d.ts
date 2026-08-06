import type { PoolClient } from 'pg';
import { AlertingWorkspaceRepository } from './alerting-workspace.repository.js';
import type { AlertingProvisioningContext, AlertingProvisioningSummary } from './alerting-workspace.types.js';
export declare class AlertingWorkspaceProvisioner {
    private readonly repository;
    constructor(repository?: AlertingWorkspaceRepository);
    provision(client: PoolClient, context: AlertingProvisioningContext): Promise<AlertingProvisioningSummary>;
}
//# sourceMappingURL=alerting-workspace.provisioner.d.ts.map