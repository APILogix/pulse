import type { PoolClient } from "pg";
import type { CursorPaginatedResponse } from "./types.js";
export declare function pgErr(e: unknown): {
    code?: string;
};
export declare function cursorPage<T extends {
    created_at: Date;
}>(rows: T[], limit: number): CursorPaginatedResponse<T>;
export declare class BaseRepository {
    protected readonly db: import("pg").Pool;
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}
//# sourceMappingURL=base.repository.d.ts.map