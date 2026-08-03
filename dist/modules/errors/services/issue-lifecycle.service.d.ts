import type { Pool } from 'pg';
import type { ErrorGroupHistoryRepository } from '../repositories/error-group-history.repository.js';
import type { ErrorGroupRepository } from '../repositories/error-group.repository.js';
export declare class InvalidTransitionError extends Error {
    readonly transition: string;
    constructor(transition: string);
}
export declare class IssueLifecycleService {
    private readonly pool;
    private readonly errorGroupRepo;
    private readonly historyRepo;
    constructor(pool: Pool, errorGroupRepo: ErrorGroupRepository, historyRepo: ErrorGroupHistoryRepository);
    resolve(projectId: string, id: string, actorId?: string): Promise<void>;
    ignore(projectId: string, id: string, actorId?: string): Promise<void>;
    reopen(projectId: string, id: string, actorId?: string): Promise<void>;
    open(projectId: string, id: string, actorId?: string): Promise<void>;
    archive(projectId: string, id: string, actorId?: string): Promise<void>;
    restore(projectId: string, id: string, actorId?: string): Promise<void>;
    regress(projectId: string, id: string, actorId?: string): Promise<void>;
    assign(projectId: string, id: string, assigneeId: string, actorId?: string): Promise<void>;
    unassign(projectId: string, id: string, actorId?: string): Promise<void>;
    mute(projectId: string, id: string, actorId?: string): Promise<void>;
    unmute(projectId: string, id: string, actorId?: string): Promise<void>;
    private executeTransition;
    private validateTransition;
}
//# sourceMappingURL=issue-lifecycle.service.d.ts.map