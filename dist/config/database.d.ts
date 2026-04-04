import { Pool } from 'pg';
export declare const pool: Pool;
export declare const closeDatabase: () => Promise<void>;
export declare const query: (text: string, params?: any[]) => Promise<import("pg").QueryResult<any>>;
//# sourceMappingURL=database.d.ts.map