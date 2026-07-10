const fs = require('fs');
const { Project, SyntaxKind } = require('ts-morph');

const project = new Project();
const originalFile = project.addSourceFileAtPath('src/modules/projects/routes.ts');

const mappings = {
    'core': {
        file: 'core/project.routes.ts',
        func: 'projectCoreRoutes',
        match: (path) => path === '/' || (path.startsWith('/:projectId') && !path.includes('/settings') && !path.includes('/environments') && !path.includes('/api-keys') && !path.includes('/sdk-configs') && !path.includes('/activity'))
    },
    'settings': {
        file: 'settings/settings.routes.ts',
        func: 'projectSettingsRoutes',
        match: (path) => path.includes('/settings')
    },
    'activity': {
        file: 'activity/activity.routes.ts',
        func: 'projectActivityRoutes',
        match: (path) => path.includes('/activity')
    },
    'environments': {
        file: 'environments/environment.routes.ts',
        func: 'projectEnvironmentRoutes',
        match: (path) => path.includes('/environments') || path.includes('/sdk-configs')
    },
    'api-keys': {
        file: 'api-keys/api-key.routes.ts',
        func: 'projectApiKeyRoutes',
        match: (path) => path.includes('/api-keys')
    }
};

const originalText = originalFile.getFullText();

for (const [domain, config] of Object.entries(mappings)) {
    fs.mkdirSync(`src/modules/projects/${domain}`, { recursive: true });
    const newFile = project.createSourceFile(`src/modules/projects/${config.file}`, originalText, { overwrite: true });
    
    // Remove utility functions
    newFile.getFunction('requestMeta')?.remove();
    newFile.getFunction('organizationRequestMeta')?.remove();
    newFile.getFunction('authenticatedUser')?.remove();
    newFile.getFunction('withErrorHandling')?.remove();

    // Import them
    newFile.addImportDeclaration({
        namedImports: ['requestMeta', 'organizationRequestMeta', 'authenticatedUser', 'withErrorHandling'],
        moduleSpecifier: '../shared/route-utils.js'
    });

    // Rename main function
    const func = newFile.getFunction('projectsRoutes');
    func.rename(config.func);

    // Change service call to use the domain service (e.g. fastify.projects.service.apiKeys)
    // Actually, to be safe, just leave it as fastify.projects.service since it's a Facade!
    
    // Filter routes
    const stmts = func.getBody().getStatements();
    stmts.forEach(stmt => {
        if (stmt.getKind() === SyntaxKind.ExpressionStatement || stmt.getKind() === SyntaxKind.ForOfStatement) {
            let keep = false;
            
            if (stmt.getKind() === SyntaxKind.ForOfStatement) {
                // This is the loop for archive/unarchive etc. It belongs to core.
                keep = config.match('/:projectId/archive');
            } else {
                const expr = stmt.getExpression();
                if (expr && expr.getKind() === SyntaxKind.CallExpression) {
                    const propAccess = expr.getExpression();
                    if (propAccess.getKind() === SyntaxKind.PropertyAccessExpression && propAccess.getExpression().getText() === 'fastify') {
                        const args = expr.getArguments();
                        if (args.length > 0) {
                            const pathArg = args[0].getText().replace(/['"]/g, '');
                            keep = config.match(pathArg);
                        }
                    }
                }
            }
            
            if (!keep) {
                // If it's a statement we didn't match as a route, check if it's the `const service = ...`
                if (stmt.getKind() !== SyntaxKind.VariableStatement) {
                    stmt.remove();
                }
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

// 2. Refactor original routes.ts
// Remove utility functions
originalFile.getFunction('requestMeta')?.remove();
originalFile.getFunction('organizationRequestMeta')?.remove();
originalFile.getFunction('authenticatedUser')?.remove();
originalFile.getFunction('withErrorHandling')?.remove();

const mainFunc = originalFile.getFunction('projectsRoutes');
const stmts = mainFunc.getBody().getStatements();
stmts.forEach(stmt => {
    stmt.remove();
});

mainFunc.addStatements(`
    await fastify.register(projectCoreRoutes);
    await fastify.register(projectSettingsRoutes);
    await fastify.register(projectActivityRoutes);
    await fastify.register(projectEnvironmentRoutes);
    await fastify.register(projectApiKeyRoutes);
`);

originalFile.addImportDeclarations([
    { namedImports: ['projectCoreRoutes'], moduleSpecifier: './core/project.routes.js' },
    { namedImports: ['projectSettingsRoutes'], moduleSpecifier: './settings/settings.routes.js' },
    { namedImports: ['projectActivityRoutes'], moduleSpecifier: './activity/activity.routes.js' },
    { namedImports: ['projectEnvironmentRoutes'], moduleSpecifier: './environments/environment.routes.js' },
    { namedImports: ['projectApiKeyRoutes'], moduleSpecifier: './api-keys/api-key.routes.js' }
]);

project.saveSync();
console.log('Project Routes Split successfully');
