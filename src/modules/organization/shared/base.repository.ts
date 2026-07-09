import type { PoolClient } from "pg";
import { pool } from "../../../config/database.js";
import type { CursorPaginatedResponse } from "./types.js";

export function pgErr(e: unknown): { code?: string } {
  return typeof e === "object" && e !== null ? (e as { code?: string }) : {};
}

export function cursorPage<T extends { created_at: Date }>(
  rows: T[], limit: number
): CursorPaginatedResponse<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return {
    data,
    meta: {
      hasMore,
      nextCursor: hasMore && data.length > 0
        ? data[data.length - 1]!.created_at.toISOString()
        : null,
      limit,
    },
  };
}

export class BaseRepository {
  protected readonly db = pool;

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
