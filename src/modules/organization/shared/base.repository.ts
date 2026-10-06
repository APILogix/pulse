import type { Pool, PoolClient } from "pg";
import { pool, withTransaction } from "../../../config/database.js";
import type { CursorPaginatedResponse } from "./types.js";

export function pgErr(e: unknown): { code?: string } {
  return typeof e === "object" && e !== null ? (e as { code?: string }) : {};
}

export function cursorPage<T extends { created_at: Date }>(
  rows: T[], limit: number, totalCount: number
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
      totalCount,
    },
  };
}

export class BaseRepository {
  protected readonly db: Pool;

  constructor(db: Pool = pool) {
    this.db = db;
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return withTransaction(fn, this.db);
  }
}
