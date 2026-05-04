import { Pool } from 'pg';
export declare const pool: Pool;
export declare const connectDB: () => Promise<void>;
export declare const query: (text: string, params?: any[]) => Promise<import("pg").QueryResult<any>>;
export declare const closeDatabase: () => Promise<void>;
//# sourceMappingURL=database.d.ts.map