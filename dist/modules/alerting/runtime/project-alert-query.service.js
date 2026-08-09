import { AlertRuntimeRepository } from './alert-runtime.repository.js';
export class ProjectAlertQueryService {
    runtime;
    constructor(logDb) {
        this.runtime = new AlertRuntimeRepository(logDb);
    }
    async list(organizationId, projectId, query) {
        const result = await this.runtime.listProjectAlertEvents(organizationId, projectId, query);
        return result;
    }
    async get(organizationId, projectId, alertEventId) {
        return this.runtime.findProjectAlertEventById(organizationId, projectId, alertEventId);
    }
}
//# sourceMappingURL=project-alert-query.service.js.map