import { AlertingWorkspaceRepository } from './alerting-workspace.repository.js';
export class AlertingWorkspaceProvisioner {
    repository;
    constructor(repository = new AlertingWorkspaceRepository()) {
        this.repository = repository;
    }
    provision(client, context) {
        return this.repository.provision(client, context);
    }
}
//# sourceMappingURL=alerting-workspace.provisioner.js.map