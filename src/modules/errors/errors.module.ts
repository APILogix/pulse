import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { pool } from '../../config/database.js';
import { ErrorGroupRepository } from './repositories/error-group.repository.js';
import { ErrorRepository } from './repositories/error.repository.js';
import { ErrorGroupingService } from './services/error-grouping.service.js';
import { ErrorIngestionService } from './services/error-ingestion.service.js';

export interface ErrorsModuleOptions {}

const errorsModulePlugin: FastifyPluginAsync<ErrorsModuleOptions> = async (app) => {
  const errorGroupRepo = new ErrorGroupRepository(pool);
  const errorRepo = new ErrorRepository(pool);
  
  const errorGroupingService = new ErrorGroupingService(errorGroupRepo);
  const errorIngestionService = new ErrorIngestionService(pool, errorGroupingService, errorRepo);

  app.decorate('errorIngestionService', errorIngestionService);
  app.decorate('errorGroupingService', errorGroupingService);
};

export const registerErrorsModule = fp(errorsModulePlugin, {
  name: 'errors-module',
});

declare module 'fastify' {
  interface FastifyInstance {
    errorIngestionService: ErrorIngestionService;
    errorGroupingService: ErrorGroupingService;
  }
}
