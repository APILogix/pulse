import type { FastifyPluginAsync } from 'fastify';
import { ErrorGroupingService } from './services/error-grouping.service.js';
import { ErrorIngestionService } from './services/error-ingestion.service.js';
export interface ErrorsModuleOptions {
}
export declare const registerErrorsModule: FastifyPluginAsync<ErrorsModuleOptions>;
declare module 'fastify' {
    interface FastifyInstance {
        errorIngestionService: ErrorIngestionService;
        errorGroupingService: ErrorGroupingService;
    }
}
//# sourceMappingURL=errors.module.d.ts.map