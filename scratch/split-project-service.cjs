const fs = require('fs');
const { Project } = require('ts-morph');

const project = new Project();
const originalFile = project.addSourceFileAtPath('src/modules/projects/service.ts');

const mappings = {
    'core': {
        file: 'core/project.service.ts',
        class: 'ProjectService',
        methods: ['listProjects', 'createProject', 'getProject', 'getProjectOverview', 'updateProject', 'deleteProject', 'restoreProject', 'archiveProject', 'unarchiveProject', 'pauseProject', 'resumeProject', 'assignProjectConfig', 'generateUniqueSlug', 'requireProjectAccess', 'enforceProjectModuleLimit', 'requireOrganizationAccess', 'limitFrom', 'assertWithinLimit', 'getProjectStats', 'getProjectUsage']
    },
    'settings': {
        file: 'settings/settings.service.ts',
        class: 'SettingsService',
        methods: ['getProjectSettings', 'updateProjectSettings', 'requireMutableBilling']
    },
    'activity': {
        file: 'activity/activity.service.ts',
        class: 'ProjectActivityService',
        methods: ['listProjectActivity', 'audit']
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

const originalText = originalFile.getFullText();

// 1. Generate domains
for (const [domain, config] of Object.entries(mappings)) {
    fs.mkdirSync(`src/modules/projects/${domain}`, { recursive: true });
    const newFile = project.createSourceFile(`src/modules/projects/${config.file}`, originalText, { overwrite: true });
    
    // Rename class
    const cls = newFile.getClass('ProjectsService');
    cls.rename(config.class);
    
    // Remove unused methods
    cls.getMethods().forEach(m => {
        const name = m.getName();
        if (!config.methods.includes(name) && name !== 'constructor') {
            m.remove();
        }
    });

    // We do NOT change constructor here so they just inherit all the same repo injections.
    // It's technically messy to have all 8 repos in all sub-services, but perfectly type-safe.

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

// 2. Refactor the original service as a Facade
const facadeCls = originalFile.getClass('ProjectsService');

// We don't remove constructor, we just instantiate the sub-services
facadeCls.insertProperty(0, { name: 'core', type: 'ProjectService', isReadonly: true, scope: 'public' });
facadeCls.insertProperty(1, { name: 'settings', type: 'SettingsService', isReadonly: true, scope: 'public' });
facadeCls.insertProperty(2, { name: 'activity', type: 'ProjectActivityService', isReadonly: true, scope: 'public' });
facadeCls.insertProperty(3, { name: 'environments', type: 'EnvironmentService', isReadonly: true, scope: 'public' });
facadeCls.insertProperty(4, { name: 'apiKeys', type: 'ApiKeyService', isReadonly: true, scope: 'public' });

// Add instantiations to constructor end
facadeCls.getConstructors()[0].addStatements(`
    this.core = new ProjectService(repository, logger, orgRepository, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    this.settings = new SettingsService(repository, logger, orgRepository, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    this.activity = new ProjectActivityService(repository, logger, orgRepository, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    this.environments = new EnvironmentService(repository, logger, orgRepository, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    this.apiKeys = new ApiKeyService(repository, logger, orgRepository, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
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
    
    if (target) {
        const args = m.getParameters().map(p => p.getName()).join(', ');
        // if the method returns something, prefix with return
        m.setBodyText(`return this.${target}.${name}(${args});`);
    }
});

// Add imports for the Facade
originalFile.addImportDeclarations([
    { namedImports: ['ProjectService'], moduleSpecifier: './core/project.service.js' },
    { namedImports: ['SettingsService'], moduleSpecifier: './settings/settings.service.js' },
    { namedImports: ['ProjectActivityService'], moduleSpecifier: './activity/activity.service.js' },
    { namedImports: ['EnvironmentService'], moduleSpecifier: './environments/environment.service.js' },
    { namedImports: ['ApiKeyService'], moduleSpecifier: './api-keys/api-key.service.js' }
]);

project.saveSync();
console.log('Project Services Facade created successfully');
