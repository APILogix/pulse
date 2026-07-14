import { authenticate, requireStepUp } from '../../../shared/middleware/auth.js';
import { DomainsController } from './domains.controller.js';
export async function registerDomainRoutes(app, service) {
    const auth = { preHandler: [authenticate] };
    const stepUp = { preHandler: [authenticate, requireStepUp] };
    const run = (fn) => async (r, reply) => {
        try {
            return reply.send({ success: true, data: await fn(r) });
        }
        catch (e) {
            throw e;
        }
    };
    const c = new DomainsController(service);
    app.get('/:organizationId/domains', auth, run(c.list));
    app.get('/:organizationId/domains/:domainId', auth, run(c.get));
    app.post('/:organizationId/domains', auth, run(c.create));
    app.post('/:organizationId/domains/:domainId/verify', auth, run(c.verify));
    app.post('/:organizationId/domains/:domainId/recheck', auth, run(c.verify));
    app.post('/:organizationId/domains/:domainId/enable-auto-join', stepUp, run(c.autoJoin(true)));
    app.post('/:organizationId/domains/:domainId/disable-auto-join', stepUp, run(c.autoJoin(false)));
    app.patch('/:organizationId/domains/:domainId', auth, run(c.update));
    app.delete('/:organizationId/domains/:domainId', stepUp, async (r, reply) => { await c.remove(r); return reply.code(204).send(); });
    app.post('/:organizationId/domains/:domainId/make-primary', stepUp, run(c.primary));
}
//# sourceMappingURL=domains.routes.js.map