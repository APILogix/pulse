import { CreateDomainSchema, DomainParamsSchema, ListDomainsSchema, OrganizationDomainParamsSchema, UpdateDomainSchema } from './domains.schema.js';
function meta(r) { const u = r.user; return { actorUserId: u.id, actorEmail: u.email, actorSessionId: u.sessionId, actorIp: r.ip, actorUserAgent: typeof r.headers['user-agent'] === 'string' ? r.headers['user-agent'] : null, httpMethod: r.method, endpoint: r.url, requestId: r.id }; }
export class DomainsController {
    service;
    constructor(service) {
        this.service = service;
    }
    list = (r) => { const p = OrganizationDomainParamsSchema.parse(r.params); return this.service.list(meta(r), p.organizationId, ListDomainsSchema.parse(r.query ?? {})); };
    get = (r) => { const p = DomainParamsSchema.parse(r.params); return this.service.get(meta(r), p.organizationId, p.domainId); };
    create = (r) => { const p = OrganizationDomainParamsSchema.parse(r.params), b = CreateDomainSchema.parse(r.body); return this.service.create(meta(r), p.organizationId, b.domain, b.metadata ?? {}); };
    verify = (r) => { const p = DomainParamsSchema.parse(r.params); return this.service.verify(meta(r), p.organizationId, p.domainId); };
    autoJoin = (enabled) => (r) => { const p = DomainParamsSchema.parse(r.params); return this.service.autoJoin(meta(r), p.organizationId, p.domainId, enabled); };
    update = (r) => { const p = DomainParamsSchema.parse(r.params), b = UpdateDomainSchema.parse(r.body); return this.service.update(meta(r), p.organizationId, p.domainId, b.metadata); };
    remove = (r) => { const p = DomainParamsSchema.parse(r.params); return this.service.delete(meta(r), p.organizationId, p.domainId); };
    primary = (r) => { const p = DomainParamsSchema.parse(r.params); return this.service.primary(meta(r), p.organizationId, p.domainId); };
}
//# sourceMappingURL=domains.controller.js.map