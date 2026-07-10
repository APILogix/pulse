const { Project } = require('ts-morph');
const fs = require('fs');

const project = new Project();
const sourceFile = project.addSourceFileAtPath('src/modules/alerting/routes.ts');

const mappings = {
    'rules': ['/rules'],
    'events': ['/events'],
    'silences': ['/silences'],
    'policies': ['/escalation-policies'],
    'templates': ['/templates'],
    'routing': ['/routing-rules'],
    'metrics': ['/metrics']
};

const originalText = sourceFile.getFullText();

// Generate a router for each domain
for (const [domain, prefixes] of Object.entries(mappings)) {
    const newFile = project.createSourceFile(`src/modules/alerting/${domain}/${domain}.routes.ts`, originalText);
    
    const func = newFile.getFunction('alertingRoutes');
    func.rename(`${domain}Routes`);
    
    // Remove unneeded routes
    func.getStatements().forEach(stmt => {
        if (stmt.getText().startsWith('fastify.')) {
            const isMatch = prefixes.some(prefix => stmt.getText().includes(`'${prefix}`) || stmt.getText().includes(`"${prefix}`));
            if (!isMatch) stmt.remove();
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

// Generate the new routes.ts
const routesContent = `import type { FastifyInstance } from 'fastify';
import { rulesRoutes } from './rules/rules.routes.js';
import { eventsRoutes } from './events/events.routes.js';
import { silencesRoutes } from './silences/silences.routes.js';
import { policiesRoutes } from './policies/policies.routes.js';
import { templatesRoutes } from './templates/templates.routes.js';
import { routingRoutes } from './routing/routing.routes.js';
import { metricsRoutes } from './metrics/metrics.routes.js';

export async function alertingRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(rulesRoutes);
  await fastify.register(eventsRoutes);
  await fastify.register(silencesRoutes);
  await fastify.register(policiesRoutes);
  await fastify.register(templatesRoutes);
  await fastify.register(routingRoutes);
  await fastify.register(metricsRoutes);
}
`;

fs.writeFileSync('src/modules/alerting/routes.ts', routesContent);
project.saveSync();
console.log('Routes extracted successfully');
