import { pool } from "../../../config/database.js";
export function pgErr(e) {
    return typeof e === "object" && e !== null ? e : {};
}
export function cursorPage(rows, limit) {
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
        },
    };
}
export class BaseRepository {
    db = pool;
    async withTransaction(fn) {
        const client = await this.db.connect();
        try {
            await client.query("BEGIN");
            const result = await fn(client);
            await client.query("COMMIT");
            return result;
        }
        catch (e) {
            await client.query("ROLLBACK");
            throw e;
        }
        finally {
            client.release();
        }
    }
}
//# sourceMappingURL=base.repository.js.map