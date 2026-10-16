import { pool } from '../../../config/database.js';
import { AlertingWorkspaceRepository } from './alerting-workspace.repository.js';
export class AlertingWorkspaceProvisioner {
    repository;
    constructor(repository = new AlertingWorkspaceRepository()) {
        this.repository = repository;
    }
    provision(client, context) {
        return this.repository.provision(client, context);
    }
    async provisionWorkspace(context) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await this.repository.provision(client, context);
            await client.query('COMMIT');
            return result;
        }
        catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        }
        finally {
            client.release();
        }
    }
}
//# sourceMappingURL=alerting-workspace.provisioner.js.map