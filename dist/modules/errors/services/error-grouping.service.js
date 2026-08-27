export class ErrorGroupingService {
    errorGroupRepo;
    constructor(errorGroupRepo) {
        this.errorGroupRepo = errorGroupRepo;
    }
    async handleGroup(client, params) {
        return this.errorGroupRepo.upsertGroup(client, params);
    }
    async handleGroupsBatch(client, items) {
        return this.errorGroupRepo.upsertGroupsBatch(client, items);
    }
}
//# sourceMappingURL=error-grouping.service.js.map