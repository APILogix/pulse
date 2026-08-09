export class ErrorGroupingService {
    errorGroupRepo;
    constructor(errorGroupRepo) {
        this.errorGroupRepo = errorGroupRepo;
    }
    async handleGroup(client, params) {
        return this.errorGroupRepo.upsertGroup(client, params);
    }
}
//# sourceMappingURL=error-grouping.service.js.map