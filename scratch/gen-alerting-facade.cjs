const { Project } = require('ts-morph');
const fs = require('fs');

const project = new Project();
const originalFile = project.addSourceFileAtPath('src/modules/alerting/rules/rules.repository.ts'); // just to get a file in the project



// Wait, I didn't make a backup of `repository.ts`!
// Let me just restore it from git if I have to, or I can use the methods from the extracted repositories.

const domains = ['rules', 'events', 'silences', 'policies', 'templates', 'routing', 'metrics'];
let classBody = `
    private rules = new RulesRepository();
    private events = new EventsRepository();
    private silences = new SilencesRepository();
    private policies = new PoliciesRepository();
    private templates = new TemplatesRepository();
    private routing = new RoutingRepository();
    private metrics = new MetricsRepository();

    async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
        return this.rules.withTransaction(fn);
    }
`;

for (const domain of domains) {
    const file = project.addSourceFileAtPath(`src/modules/alerting/${domain}/${domain}.repository.ts`);
    const cls = file.getClasses()[0];
    
    cls.getMethods().forEach(m => {
        if (m.getName() === 'withTransaction') return;
        
        // Ensure private methods aren't exported
        if (m.getScope() === 'private' || m.getScope() === 'protected') return;
        
        const name = m.getName();
        const signature = m.getParameters().map(p => p.getText()).join(', ');
        const args = m.getParameters().map(p => p.getName()).join(', ');
        const returnType = m.getReturnTypeNode() ? `: ${m.getReturnTypeNode().getText()}` : '';
        
        classBody += `
    async ${name}(${signature})${returnType} {
        return this.${domain}.${name}(${args});
    }
`;
    });
}

const facadeContent = `import type { PoolClient } from 'pg';
import { RulesRepository } from './rules/rules.repository.js';
import { EventsRepository } from './events/events.repository.js';
import { SilencesRepository } from './silences/silences.repository.js';
import { PoliciesRepository } from './policies/policies.repository.js';
import { TemplatesRepository } from './templates/templates.repository.js';
import { RoutingRepository } from './routing/routing.repository.js';
import { MetricsRepository } from './metrics/metrics.repository.js';

export * from './rules/rules.repository.js';
export * from './events/events.repository.js';
export * from './silences/silences.repository.js';
export * from './policies/policies.repository.js';
export * from './templates/templates.repository.js';
export * from './routing/routing.repository.js';
export * from './metrics/metrics.repository.js';

import type { ListRulesQuery, ListEventsQuery, AlertEventStatus, MetricGranularity } from './types.js';

export class AlertingRepository {
${classBody}
}
`;

fs.writeFileSync('src/modules/alerting/repository.ts', facadeContent);
console.log('Facade generated accurately from extracted repos');
