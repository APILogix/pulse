/**
 * Auth Module — Fastify registration.
 *
 * Wrapped in fastify-plugin so any request-level decorations or future
 * decorators (e.g., auth.service) are visible across the entire Fastify
 * instance, not encapsulated within this plugin scope.
 *
 * Flow:
 *   1. Decorate the request with a `null` default for `user` so any handler
 *      that forgets the `authenticate` preHandler fails safely (TypeScript
 *      compile error vs. a runtime "cannot read properties of undefined").
 *   2. Register the auth routes under /auth.
 */
import type { FastifyInstance } from 'fastify';
declare function authModule(fastify: FastifyInstance): Promise<void>;
export declare const registerAuthModule: typeof authModule;
export default registerAuthModule;
//# sourceMappingURL=auth.module.d.ts.map