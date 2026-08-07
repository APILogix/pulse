import type { Pool } from 'pg';
import type { QueryContext } from './query-engine/index.js';
export declare class ObservabilityReleasesRepository {
    private readonly pool;
    constructor(pool: Pool);
    list(ctx: QueryContext, rawQuery: unknown): Promise<Record<string, unknown>>;
    private emptyResponse;
}
//# sourceMappingURL=releases.repository.d.ts.map