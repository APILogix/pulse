import type { FastifyInstance } from 'fastify';
import { PostgresWriter } from './postgress.writter.js';
declare module 'fastify' {
    interface FastifyInstance {
        postgresWriter: PostgresWriter;
    }
}
export declare const ingestionModule: (fastify: FastifyInstance) => Promise<void>;
//# sourceMappingURL=ingestion.module.d.ts.map