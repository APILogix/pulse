import { UsageRepository } from './repository.js';
import { BillingError, BillingErrorCodes } from '../shared/errors.js';
export class UsageService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async getCurrentUsage(orgId) {
        const usage = await this.repository.getCurrentUsage(orgId);
        if (!usage) {
            // Return zeros if no usage row exists yet (might happen right after org creation before sub is set)
            return {
                success: true,
                data: {
                    eventsUsed: 0,
                    eventLimit: 0,
                    aiCreditsUsed: 0,
                    aiCreditLimit: 0,
                }
            };
        }
        return {
            success: true,
            data: {
                eventsUsed: usage.events_used,
                eventLimit: usage.event_limit,
                remainingEvents: usage.remaining_events,
                aiCreditsUsed: usage.ai_credits_used,
                aiCreditLimit: usage.ai_credit_limit,
                remainingAiCredits: usage.remaining_ai_credits,
                projectsUsed: usage.projects_used,
                membersUsed: usage.members_used,
            }
        };
    }
    async incrementEventUsage(orgId, count = 1) {
        // In a real high-throughput system, this would be buffered via Redis or Kafka.
        // For this redesign, we directly hit the PG fast-path function.
        await this.repository.incrementEventUsage(orgId, count);
        return { success: true };
    }
    async getDailyUsage(orgId, startDate, endDate) {
        const records = await this.repository.getDailyUsageRecords(orgId, startDate, endDate);
        return {
            success: true,
            data: records.map(r => ({
                date: r.usage_date,
                eventsCount: r.events_count,
                aiCreditsUsed: r.ai_credits_used,
                errorsCount: r.errors_count,
                requestsCount: r.requests_count
            }))
        };
    }
}
//# sourceMappingURL=service.js.map