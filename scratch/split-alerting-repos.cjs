const { Project } = require('ts-morph');
const fs = require('fs');
const path = require('path');

const project = new Project();
const sourceFile = project.addSourceFileAtPath('src/modules/alerting/repository.ts');
const originalText = sourceFile.getFullText();

const mappings = {
    'rules': ['withTransaction', 'createRule', 'insertConditions', 'insertActions', 'findRuleById', 'getRuleConditions', 'getRuleActions', 'listRules', 'updateRule', 'softDeleteRule', 'setRuleEnabled'],
    'events': ['withTransaction', 'findActiveEventByFingerprint', 'incrementDuplicate', 'insertEvent', 'findEventById', 'listEvents', 'acknowledgeEvent', 'resolveEvent', 'insertHistory', 'getEventHistory', 'getEventDeliveries', 'createBatchFromPending', 'getBatchWithEvents', 'completeBatch', 'bulkUpdateEventStatus', 'bulkInsertDeliveryAttempts', 'findOrgsWithPendingEvents', 'claimAutoResolvable'],
    'silences': ['withTransaction', 'createSilence', 'listSilences', 'expireSilence', 'findActiveSilences'],
    'policies': ['withTransaction', 'createEscalationPolicy', 'listEscalationPolicies', 'findEscalationPolicy', 'deleteEscalationPolicy', 'upsertEscalationStep', 'listEscalationSteps'],
    'templates': ['withTransaction', 'createTemplate', 'findTemplate', 'listTemplates', 'deleteTemplate'],
    'routing': ['withTransaction', 'createRoutingRule', 'listRoutingRules', 'findRoutingRule', 'deleteRoutingRule'],
    'metrics': ['withTransaction', 'queryMetrics', 'getRealtimeStats']
};

for (const [domain, methods] of Object.entries(mappings)) {
    fs.mkdirSync(`src/modules/alerting/${domain}`, { recursive: true });
    const newFile = project.createSourceFile(`src/modules/alerting/${domain}/${domain}.repository.ts`, originalText);
    
    // Rename class
    const cls = newFile.getClass('AlertingRepository');
    const className = domain.charAt(0).toUpperCase() + domain.slice(1) + 'Repository';
    cls.rename(className);
    
    // Remove unused methods
    cls.getMethods().forEach(m => {
        if (!methods.includes(m.getName())) {
            m.remove();
        }
    });

    // Fix imports
    newFile.getImportDeclarations().forEach(imp => {
        const val = imp.getModuleSpecifierValue();
        if (val.startsWith('../../')) {
            imp.setModuleSpecifier('../' + val);
        } else if (val === './types.js') {
            imp.setModuleSpecifier('../types.js');
        }
    });
}

// Write a facade repository.ts
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

export class AlertingRepository {
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
    
    // Auto-delegate methods
    ${sourceFile.getClass('AlertingRepository').getMethods().filter(m => m.getName() !== 'withTransaction').map(m => {
        const name = m.getName();
        const params = m.getParameters().map(p => p.getName()).join(', ');
        let target = 'rules';
        if (mappings.events.includes(name)) target = 'events';
        else if (mappings.silences.includes(name)) target = 'silences';
        else if (mappings.policies.includes(name)) target = 'policies';
        else if (mappings.templates.includes(name)) target = 'templates';
        else if (mappings.routing.includes(name)) target = 'routing';
        else if (mappings.metrics.includes(name)) target = 'metrics';
        
        const paramsWithTypes = m.getParameters().map(p => p.getText()).join(', ');
        return `async ${name}(${paramsWithTypes}) { return this.${target}.${name}(${params}); }`;
    }).join('\n    ')}
}
`;

project.saveSync();
fs.writeFileSync('src/modules/alerting/repository.ts', facadeContent);
console.log('Repositories extracted successfully');
