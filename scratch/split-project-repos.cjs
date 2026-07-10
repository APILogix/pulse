const { Project } = require('ts-morph');
const fs = require('fs');

const project = new Project();
const originalFile = project.addSourceFileAtPath('src/modules/projects/repository.ts');

const mappings = {
    'core': {
        file: 'core/project.repository.ts',
        class: 'ProjectRepository',
        methods: ['listProjects', 'createProject', 'findProjectBySlug', 'findProjectById', 'findProjectByIdIncludingDeleted', 'updateProject', 'softDeleteProject', 'restoreProject', 'prefixedProjectRow', 'mapProject', 'mapProjectWithCounts', 'buildProjectAssignments']
    },
    'members': {
        file: 'members/member.repository.ts',
        class: 'MemberRepository',
        methods: ['findOrganizationMembership', 'buildProjectAssignments']
    },
    'usage': {
        file: 'usage/project-usage.repository.ts',
        class: 'ProjectUsageRepository',
        methods: ['getProjectStats', 'getProjectUsageCounters', 'getProjectModuleUsageCounts']
    },
    'settings': {
        file: 'settings/project-settings.repository.ts',
        class: 'ProjectSettingsRepository',
        methods: ['findSdkConfigPlanKey', 'createDefaultSdkConfigs']
    }
};

const originalText = originalFile.getFullText();

// 1. Generate domains
for (const [domain, config] of Object.entries(mappings)) {
    fs.mkdirSync(`src/modules/projects/${domain}`, { recursive: true });
    const newFile = project.createSourceFile(`src/modules/projects/${config.file}`, originalText, { overwrite: true });
    
    // Rename class
    const cls = newFile.getClass('ProjectsRepository');
    cls.rename(config.class);
    
    // Remove unused methods
    cls.getMethods().forEach(m => {
        const name = m.getName();
        if (!config.methods.includes(name) && name !== 'constructor' && name !== 'withTransaction') {
            m.remove();
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

// 2. Refactor the original repository as a Facade
const facadeCls = originalFile.getClass('ProjectsRepository');

// Add properties
facadeCls.insertProperty(0, { name: 'core', type: 'ProjectRepository', isReadonly: true, scope: 'private' });
facadeCls.insertProperty(1, { name: 'members', type: 'MemberRepository', isReadonly: true, scope: 'private' });
facadeCls.insertProperty(2, { name: 'usage', type: 'ProjectUsageRepository', isReadonly: true, scope: 'private' });
facadeCls.insertProperty(3, { name: 'settings', type: 'ProjectSettingsRepository', isReadonly: true, scope: 'private' });

// Rewrite constructor
facadeCls.getConstructors()[0].setBodyText(`
    this.core = new ProjectRepository(db);
    this.members = new MemberRepository(db);
    this.usage = new ProjectUsageRepository(db);
    this.settings = new ProjectSettingsRepository(db);
`);

// Rewrite methods
facadeCls.getMethods().forEach(m => {
    const name = m.getName();
    if (name === 'withTransaction') {
        m.setBodyText('return this.core.withTransaction(fn);');
        return;
    }
    
    let target = null;
    if (mappings.core.methods.includes(name) && !['prefixedProjectRow', 'mapProject', 'mapProjectWithCounts', 'buildProjectAssignments'].includes(name)) target = 'core';
    else if (mappings.members.methods.includes(name) && name !== 'buildProjectAssignments') target = 'members';
    else if (mappings.usage.methods.includes(name)) target = 'usage';
    else if (mappings.settings.methods.includes(name)) target = 'settings';
    
    if (target) {
        const args = m.getParameters().map(p => p.getName()).join(', ');
        m.setBodyText(`return this.${target}.${name}(${args});`);
    } else {
        m.remove();
    }
});

// Add imports for the Facade
originalFile.addImportDeclarations([
    { namedImports: ['ProjectRepository'], moduleSpecifier: './core/project.repository.js' },
    { namedImports: ['MemberRepository'], moduleSpecifier: './members/member.repository.js' },
    { namedImports: ['ProjectUsageRepository'], moduleSpecifier: './usage/project-usage.repository.js' },
    { namedImports: ['ProjectSettingsRepository'], moduleSpecifier: './settings/project-settings.repository.js' }
]);

// Add exports to the Facade so other files can use them
originalFile.addExportDeclarations([
    { moduleSpecifier: './core/project.repository.js' },
    { moduleSpecifier: './members/member.repository.js' },
    { moduleSpecifier: './usage/project-usage.repository.js' },
    { moduleSpecifier: './settings/project-settings.repository.js' }
]);

project.saveSync();
console.log('Project Repositories Facade created successfully');
