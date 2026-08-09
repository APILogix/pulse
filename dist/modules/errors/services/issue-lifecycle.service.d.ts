import type { Pool } from 'pg';
import type { ErrorGroupRepository } from '../repositories/error-group.repository.js';
import type { ErrorGroupHistoryRepository } from '../repositories/error-group-history.repository.js';
export declare class InvalidTransitionError extends Error {
    readonly transition: string;
    constructor(transition: string);
}
export declare class LifecycleConflictError extends Error {
    constructor(message?: string);
}
export interface LifecycleOptions {
    actorId?: string;
    reason?: string;
    release?: string | null;
    expectedVersion?: number;
}
type LifecycleInput = LifecycleOptions | string | undefined;
export declare class IssueLifecycleService {
    private readonly pool;
    private readonly errorGroupRepo;
    private readonly historyRepo;
    constructor(pool: Pool, errorGroupRepo: ErrorGroupRepository, historyRepo: ErrorGroupHistoryRepository);
    resolve(projectId: string, id: string, options?: LifecycleInput): Promise<void>;
    ignore(projectId: string, id: string, options?: LifecycleInput): Promise<void>;
    reopen(projectId: string, id: string, options?: LifecycleInput): Promise<void>;
    open(projectId: string, id: string, options?: LifecycleInput): Promise<void>;
    restore(projectId: string, id: string, options?: LifecycleInput): Promise<void>;
    archive(projectId: string, id: string, options?: LifecycleInput): Promise<void>;
    merge(projectId: string, sourceId: string, targetId: string, input?: LifecycleInput): Promise<void>;
    unmerge(projectId: string, sourceId: string, input?: LifecycleInput): Promise<void>;
    private executeTransition;
    private validateTransition;
}
export {};
//# sourceMappingURL=issue-lifecycle.service.d.ts.map