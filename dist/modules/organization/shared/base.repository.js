import { pool, withTransaction } from "../../../config/database.js";
export function pgErr(e) {
    return typeof e === "object" && e !== null ? e : {};
}
export function cursorPage(rows, limit, totalCount) {
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return {
        data,
        meta: {
            hasMore,
            nextCursor: hasMore && data.length > 0
                ? data[data.length - 1].created_at.toISOString()
                : null,
            limit,
            totalCount,
        },
    };
}
export class BaseRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async withTransaction(fn) {
        return withTransaction(fn, this.db);
    }
}
//# sourceMappingURL=base.repository.js.map