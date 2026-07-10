const { Project } = require('ts-morph');
const fs = require('fs');

const project = new Project();
const sourceFile = project.addSourceFileAtPath('src/modules/alerting/service.ts');
const originalText = sourceFile.getFullText();

const mappings = {
    'rules': ['createRule', 'listRules', 'getRule', 'updateRule', 'deleteRule', 'setRuleEnabled', 'cloneRule', 'testRule', 'ruleToDto'],
    'events': ['ingestEvent', 'listEvents', 'getEvent', 'getEventDeliveries', 'acknowledgeEvent', 'resolveEvent', 'silenceFromEvent', 'computeAutoResolveAt', 'requireEvent', 'eventToDto', 'silenceToDto', 'requireRule'],
    'silences': ['createSilence', 'listSilences', 'expireSilence', 'silenceToDto'],
    'policies': ['createEscalationPolicy', 'listEscalationPolicies', 'getEscalationPolicy', 'deleteEscalationPolicy', 'upsertEscalationStep'],
    'templates': ['createTemplate', 'listTemplates', 'deleteTemplate', 'previewTemplate'],
    'routing': ['createRoutingRule', 'listRoutingRules', 'deleteRoutingRule', 'testRouting'],
    'metrics': ['getMetrics', 'getStats']
};

for (const [domain, methods] of Object.entries(mappings)) {
    fs.mkdirSync(`src/modules/alerting/${domain}`, { recursive: true });
    const newFile = project.createSourceFile(`src/modules/alerting/${domain}/${domain}.service.ts`, originalText);
    
    // Rename class
    const cls = newFile.getClass('AlertingService');
    const className = domain.charAt(0).toUpperCase() + domain.slice(1) + 'Service';
    cls.rename(className);
    
    // Remove unused methods
    cls.getMethods().forEach(m => {
        const name = m.getName();
        if (name === 'constructor' || name === 'audit') return;
        if (!methods.includes(name)) {
            m.remove();
        } else {
            // make the helper methods private
            if (['computeAutoResolveAt', 'requireEvent', 'requireRule', 'ruleToDto', 'eventToDto', 'silenceToDto'].includes(name)) {
                // leave as private
            }
        }
    });

    // Fix imports
    newFile.getImportDeclarations().forEach(imp => {
        const val = imp.getModuleSpecifierValue();
        if (val.startsWith('../../')) {
            imp.setModuleSpecifier('../' + val);
        } else if (val.startsWith('./')) {
            imp.setModuleSpecifier('.' + val);
        }
    });
}

// Generate the Facade
let facadeContent = `import type { FastifyBaseLogger } from 'fastify';
import { AlertingRepository } from './repository.js';
import { RulesService } from './rules/rules.service.js';
import { EventsService } from './events/events.service.js';
import { SilencesService } from './silences/silences.service.js';
import { PoliciesService } from './policies/policies.service.js';
import { TemplatesService } from './templates/templates.service.js';
import { RoutingService } from './routing/routing.service.js';
import { MetricsService } from './metrics/metrics.service.js';
import type { RequestMeta } from './types.js';

export * from './rules/rules.service.js';
export * from './events/events.service.js';
export * from './silences/silences.service.js';
export * from './policies/policies.service.js';
export * from './templates/templates.service.js';
export * from './routing/routing.service.js';
export * from './metrics/metrics.service.js';

export interface AlertingServiceDeps {
  repository: AlertingRepository;
  logger: FastifyBaseLogger;
}

export class AlertingService {
  private readonly rules: RulesService;
  private readonly events: EventsService;
  private readonly silences: SilencesService;
  private readonly policies: PoliciesService;
  private readonly templates: TemplatesService;
  private readonly routing: RoutingService;
  private readonly metrics: MetricsService;

  constructor(deps: AlertingServiceDeps) {
    this.rules = new RulesService(deps);
    this.events = new EventsService(deps);
    this.silences = new SilencesService(deps);
    this.policies = new PoliciesService(deps);
    this.templates = new TemplatesService(deps);
    this.routing = new RoutingService(deps);
    this.metrics = new MetricsService(deps);
  }
`;

const cls = sourceFile.getClass('AlertingService');
cls.getMethods().forEach(m => {
    const name = m.getName();
    if (name === 'constructor' || m.getScope() === 'private') return;
    
    let target = 'rules';
    if (mappings.events.includes(name)) target = 'events';
    else if (mappings.silences.includes(name)) target = 'silences';
    else if (mappings.policies.includes(name)) target = 'policies';
    else if (mappings.templates.includes(name)) target = 'templates';
    else if (mappings.routing.includes(name)) target = 'routing';
    else if (mappings.metrics.includes(name)) target = 'metrics';

    const argsSignature = m.getParameters().map(p => p.getText()).join(', ');
    const argsNames = m.getParameters().map(p => p.getName()).join(', ');
    const returnType = m.getReturnTypeNode() ? m.getReturnTypeNode().getText() : 'any';

    facadeContent += `
  async ${name}(${argsSignature}): Promise<${returnType}> {
    return this.${target}.${name}(${argsNames});
  }
`;
});

facadeContent += `}\n`;

project.saveSync();
fs.writeFileSync('src/modules/alerting/service.ts', facadeContent);
console.log('Services extracted successfully');
