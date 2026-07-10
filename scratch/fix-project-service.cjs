const fs = require('fs');
const { Project } = require('ts-morph');

const project = new Project();
project.addSourceFilesAtPaths('src/modules/projects/**/*.ts');

// 1. Fix BaseProjectService
const baseFile = project.getSourceFile('src/modules/projects/shared/base.service.ts');
baseFile.getImportDeclarations().forEach(imp => {
    if (imp.getModuleSpecifierValue().includes('organization/repository')) {
        imp.setModuleSpecifier('../../../organization/repository.js');
    }
});
const baseCls = baseFile.getClass('BaseProjectService');
baseCls.getMethods().forEach(m => {
    if (m.getScope() === 'protected') m.setScope('public'); // make public so facade can delegate or sub-services can access easily
});
baseCls.getConstructors()[0].getParameters().forEach(p => {
    p.setScope('public'); // public readonly
});
// Fix TS18046 'record' is of type 'unknown' in audit method
const auditMethod = baseCls.getMethod('audit');
if (auditMethod) {
    auditMethod.getParameters().forEach(p => {
        if (p.getName() === 'metadata' && p.getTypeNode() && p.getTypeNode().getText() === 'unknown') {
            p.setType('Record<string, unknown>');
        }
    });
}

// 2. Fix Sub-services
['core/project', 'settings/settings', 'activity/activity', 'environments/environment', 'api-keys/api-key'].forEach(d => {
    const file = project.getSourceFile('src/modules/projects/' + d + '.service.ts');
    if (!file) return;
    
    file.getImportDeclarations().forEach(imp => {
        if (imp.getModuleSpecifierValue().includes('organization/repository')) {
            imp.setModuleSpecifier('../../../organization/repository.js');
        }
    });
    
    const cls = file.getClasses()[0];
    const ctor = cls.getConstructors()[0];
    if (ctor) {
        ctor.getParameters().forEach(p => {
            // Remove 'private readonly' so it doesn't shadow the base class properties
            p.setScope(undefined);
            p.setIsReadonly(false);
        });
    }
});

// 3. Fix Facade service.ts
const facadeFile = project.getSourceFile('src/modules/projects/service.ts');
const facadeCls = facadeFile.getClass('ProjectsService');
const ctor = facadeCls.getConstructors()[0];
if (ctor) {
    // In the facade constructor, we need to pass the arguments correctly.
    // The arguments are exactly what is in the parameters.
    const args = ctor.getParameters().map(p => p.getName()).join(', ');
    ctor.setBodyText(
    "this.core = new ProjectService(" + args + ");\n" +
    "this.settings = new SettingsService(" + args + ");\n" +
    "this.activity = new ProjectActivityService(" + args + ");\n" +
    "this.environments = new EnvironmentService(" + args + ");\n" +
    "this.apiKeys = new ApiKeyService(" + args + ");\n" +
    "this.base = new BaseProjectService(" + args + ");"
    );
}

// Fix unknown type in facade audit method if exists
const facadeAudit = facadeCls.getMethod('audit');
if (facadeAudit) {
    facadeAudit.getParameters().forEach(p => {
        if (p.getName() === 'metadata' && p.getTypeNode() && p.getTypeNode().getText() === 'unknown') {
            p.setType('Record<string, unknown>');
        }
    });
}

project.saveSync();
console.log('Project Services fixed');
