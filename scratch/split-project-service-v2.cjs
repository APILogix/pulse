const fs = require('fs');
const { Project } = require('ts-morph');

const project = new Project();
const originalFile = project.addSourceFileAtPath('src/modules/projects/service.ts');

const mappings = {
    'core': {
        file: 'core/project.service.ts',
        class: 'ProjectService',
        methods: ['listProjects', 'createProject', 'getProject', 'getProjectOverview', 'updateProject', 'deleteProject', 'restoreProject', 'archiveProject', 'unarchiveProject', 'pauseProject', 'resumeProject']
    },
    'settings': {
        file: 'settings/settings.service.ts',
        class: 'SettingsService',
        methods: ['getProjectSettings', 'updateProjectSettings']
    },
    'activity': {
        file: 'activity/activity.service.ts',
        class: 'ProjectActivityService',
        methods: ['listProjectActivity']
    },
    'environments': {
        file: 'environments/environment.service.ts',
        class: 'EnvironmentService',
        methods: ['listEnvironments', 'getEnvironment', 'createEnvironment', 'updateEnvironment', 'deleteEnvironment']
    },
    'api-keys': {
        file: 'api-keys/api-key.service.ts',
        class: 'ApiKeyService',
        methods: ['listApiKeys', 'createApiKey', 'getApiKey', 'updateApiKey', 'deleteApiKey', 'rotateApiKey', 'regenerateApiKey', 'enableApiKey', 'disableApiKey', 'bulkRotateKeys', 'bulkRevokeKeys', 'getApiKeyUsage', 'validateApiKey', 'assertFutureExpiry', 'publicApiKey', 'summarizeBulk', 'warmApiKeyCache', 'evictApiKeyConfig', 'evictProjectApiKeys']
    }
};

const sharedMethods = ['requireOrganizationAccess', 'requireProjectAccess', 'limitFrom', 'assertWithinLimit', 'requireMutableBilling', 'enforceProjectModuleLimit', 'assignProjectConfig', 'generateUniqueSlug', 'audit', 'getProjectStats', 'getProjectUsage'];

const originalText = originalFile.getFullText();

// 1. Create BaseProjectService
fs.mkdirSync('src/modules/projects/shared', { recursive: true });
const baseFile = project.createSourceFile('src/modules/projects/shared/base.service.ts', originalText, { overwrite: true });
const baseCls = baseFile.getClass('ProjectsService');
baseCls.rename('BaseProjectService');
baseCls.getMethods().forEach(m => {
    const name = m.getName();
    if (!sharedMethods.includes(name) && name !== 'constructor') {
        m.remove();
    } else {
        // change private methods to protected so derived classes can use them
        if (m.getScope() === 'private') {
            m.setScope('protected');
        }
    }
});
baseCls.getConstructors()[0].getParameters().forEach(p => {
    if (p.getScope() === 'private') {
        p.setScope('protected');
    }
});
// Fix imports in base
baseFile.getImportDeclarations().forEach(imp => {
    const val = imp.getModuleSpecifierValue();
    if (val.startsWith('../../')) {
        imp.setModuleSpecifier('../' + val);
    } else if (val.startsWith('./')) {
        imp.setModuleSpecifier('.' + val);
    }
});

// 2. Generate domains
for (const [domain, config] of Object.entries(mappings)) {
    fs.mkdirSync(`src/modules/projects/${domain}`, { recursive: true });
    const newFile = project.createSourceFile(`src/modules/projects/${config.file}`, originalText, { overwrite: true });
    
    // Rename class
    const cls = newFile.getClass('ProjectsService');
    cls.rename(config.class);
    
    // Set base class
    cls.setExtends('BaseProjectService');
    newFile.addImportDeclaration({
        namedImports: ['BaseProjectService'],
        moduleSpecifier: '../shared/base.service.js'
    });

    // Remove unused methods
    cls.getMethods().forEach(m => {
        const name = m.getName();
        if (!config.methods.includes(name) && name !== 'constructor') {
            m.remove();
        } else if (config.methods.includes(name) && m.getScope() === 'private') {
            m.setScope('public');
        }
    });

    // We keep constructor, but it just calls super
    cls.getConstructors()[0].setBodyText('super(repository, logger, orgRepository, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);');

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

// 3. Refactor the original service as a Facade
const facadeCls = originalFile.getClass('ProjectsService');

facadeCls.insertProperty(0, { name: 'core', type: 'ProjectService', isReadonly: true, scope: 'public' });
facadeCls.insertProperty(1, { name: 'settings', type: 'SettingsService', isReadonly: true, scope: 'public' });
facadeCls.insertProperty(2, { name: 'activity', type: 'ProjectActivityService', isReadonly: true, scope: 'public' });
facadeCls.insertProperty(3, { name: 'environments', type: 'EnvironmentService', isReadonly: true, scope: 'public' });
facadeCls.insertProperty(4, { name: 'apiKeys', type: 'ApiKeyService', isReadonly: true, scope: 'public' });
facadeCls.insertProperty(5, { name: 'base', type: 'BaseProjectService', isReadonly: true, scope: 'public' });

// Add instantiations to constructor end
facadeCls.getConstructors()[0].addStatements(`
    this.core = new ProjectService(repository, logger, orgRepository, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    this.settings = new SettingsService(repository, logger, orgRepository, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    this.activity = new ProjectActivityService(repository, logger, orgRepository, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    this.environments = new EnvironmentService(repository, logger, orgRepository, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    this.apiKeys = new ApiKeyService(repository, logger, orgRepository, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    this.base = new BaseProjectService(repository, logger, orgRepository, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
`);

// Rewrite methods
facadeCls.getMethods().forEach(m => {
    const name = m.getName();
    
    let target = null;
    for (const [domain, config] of Object.entries(mappings)) {
        if (config.methods.includes(name)) {
            target = domain === 'api-keys' ? 'apiKeys' : domain;
            break;
        }
    }
    if (!target && sharedMethods.includes(name)) {
        target = 'base';
    }
    
    if (target) {
        const args = m.getParameters().map(p => p.getName()).join(', ');
        if (m.getReturnTypeNode() && m.getReturnTypeNode().getText() === 'void') {
            m.setBodyText(`this.${target}.${name}(${args});`);
        } else {
            m.setBodyText(`return this.${target}.${name}(${args}) as any;`);
        }
    }
});

// Add imports for the Facade
originalFile.addImportDeclarations([
    { namedImports: ['ProjectService'], moduleSpecifier: './core/project.service.js' },
    { namedImports: ['SettingsService'], moduleSpecifier: './settings/settings.service.js' },
    { namedImports: ['ProjectActivityService'], moduleSpecifier: './activity/activity.service.js' },
    { namedImports: ['EnvironmentService'], moduleSpecifier: './environments/environment.service.js' },
    { namedImports: ['ApiKeyService'], moduleSpecifier: './api-keys/api-key.service.js' },
    { namedImports: ['BaseProjectService'], moduleSpecifier: './shared/base.service.js' }
]);

project.saveSync();
console.log('Project Services Extracted using BaseProjectService successfully');
