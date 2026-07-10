const fs = require('fs');
const { Project } = require('ts-morph');

const project = new Project();
project.addSourceFilesAtPaths('src/modules/projects/**/*.ts');

// 1. Move evictProjectApiKeys to BaseProjectService
const apiFile = project.getSourceFile('src/modules/projects/api-keys/api-key.service.ts');
const baseFile = project.getSourceFile('src/modules/projects/shared/base.service.ts');
const coreFile = project.getSourceFile('src/modules/projects/core/project.service.ts');
const facadeFile = project.getSourceFile('src/modules/projects/service.ts');

if (apiFile && baseFile) {
    const apiCls = apiFile.getClass('ApiKeyService');
    const baseCls = baseFile.getClass('BaseProjectService');
    const method = apiCls.getMethod('evictProjectApiKeys');
    if (method && !baseCls.getMethod('evictProjectApiKeys')) {
        baseCls.addMethod({
            name: 'evictProjectApiKeys',
            isAsync: method.isAsync(),
            parameters: method.getParameters().map(p => ({ name: p.getName(), type: p.getTypeNode().getText() })),
            returnType: method.getReturnTypeNode().getText(),
            statements: method.getBodyText(),
            scope: 'public'
        });
        method.remove();
    }
}

// 2. Fix the unknown issue in base.service.ts audit method
if (baseFile) {
    const baseCls = baseFile.getClass('BaseProjectService');
    const auditMethod = baseCls.getMethod('audit');
    if (auditMethod) {
        auditMethod.getParameters().forEach(p => {
            if (p.getName() === 'metadata') {
                p.setType('Record<string, any>');
            }
        });
    }
}

if (coreFile) {
    // Revert the powershell mess up
    let text = coreFile.getFullText().replace(/this\.apiKeys\.evictProjectApiKeys/g, 'this.evictProjectApiKeys');
    coreFile.replaceWithText(text);
}

if (facadeFile) {
    const cls = facadeFile.getClass('ProjectsService');
    const m = cls.getMethod('evictProjectApiKeys');
    if (m) m.setBodyText('return this.base.evictProjectApiKeys(projectId);');
}

project.saveSync();
console.log('Final fixes applied');
