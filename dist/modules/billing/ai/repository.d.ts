import type { Pool, PoolClient } from 'pg';
type Db = Pool | PoolClient;
export interface AiUsageLogRecord {
    organization_id: string;
    project_id?: string;
    user_id?: string;
    feature_key: string;
    provider: string;
    model: string;
    credits_used: number;
    prompt_tokens: number;
    completion_tokens: number;
    estimated_cost_usd: number;
}
export declare class AiBillingRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    logAiUsage(record: AiUsageLogRecord, db?: Db): Promise<void>;
    consumeAiCredits(orgId: string, credits: number, db?: Db): Promise<void>;
    hasSufficientAiCredits(orgId: string, requiredCredits: number, db?: Db): Promise<boolean>;
}
export {};
//# sourceMappingURL=repository.d.ts.map