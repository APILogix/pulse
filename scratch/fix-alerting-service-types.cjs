const fs = require('fs');
const { Project } = require('ts-morph');

const project = new Project();
project.addSourceFilesAtPaths('src/modules/alerting/**/*.ts');

// 1. Fix facade imports
const facade = project.getSourceFile('src/modules/alerting/service.ts');
facade.addImportDeclaration({
    moduleSpecifier: './types.js',
    isTypeOnly: true,
    namedImports: [
        'CreateRuleBody', 'ListRulesQuery', 'UpdateRuleBody', 'TestRuleBody',
        'IngestEventBody', 'ListEventsQuery', 'AcknowledgeEventBody', 'ResolveEventBody',
        'CreateSilenceBody', 'CreateEscalationPolicyBody', 'UpsertEscalationStepBody',
        'CreateTemplateBody', 'CreateRoutingRuleBody', 'TestRoutingBody', 'MetricsQuery'
    ]
});

// 2. Fix inner services
const domains = ['rules', 'events', 'silences', 'policies', 'templates', 'routing', 'metrics'];

for (const domain of domains) {
    const file = project.getSourceFile(`src/modules/alerting/${domain}/${domain}.service.ts`);
    if (!file) continue;
    
    const cls = file.getClass(`${domain.charAt(0).toUpperCase()}${domain.slice(1)}Service`);
    
    // Add missing private methods
    if (domain === 'rules' && !cls.getMethod('requireRule')) {
        cls.addMethod({
            name: 'requireRule',
            scope: 'private',
            isAsync: true,
            parameters: [{ name: 'orgId', type: 'string' }, { name: 'id', type: 'string' }],
            returnType: 'Promise<import("../types.js").AlertRuleRow>',
            statements: `
                const rule = await this.repo.findRuleById(orgId, id);
                if (!rule) throw new (await import("../types.js")).AlertNotFoundError('Alert rule');
                return rule;
            `
        });
    }

    // Fix import('./types.js') to import('../types.js')
    const text = file.getFullText().replace(/import\('\.\/types\.js'\)/g, "import('../types.js')");
    file.replaceWithText(text);
}

project.saveSync();
console.log('Fixed services types');
