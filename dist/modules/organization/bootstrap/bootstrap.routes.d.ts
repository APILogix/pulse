import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { type BootstrapService } from './bootstrap.service.js';
interface BootstrapRouteOptions extends FastifyPluginOptions {
    service?: BootstrapService;
}
export declare function bootstrapRoutes(fastify: FastifyInstance, options: BootstrapRouteOptions): Promise<void>;
export default bootstrapRoutes;
//# sourceMappingURL=bootstrap.routes.d.ts.map