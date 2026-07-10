const { Project } = require('ts-morph');
const fs = require('fs');

const project = new Project();
project.addSourceFilesAtPaths('src/modules/connectors/**/*.ts');

const registry = project.getSourceFile('src/modules/connectors/registry.ts');
if (registry) {
    registry.getImportDeclarations().forEach(i => {
        const val = i.getModuleSpecifierValue();
        if (val === './connectors/base.connector.js') i.setModuleSpecifier('./shared/base.connector.js');
        else if (val.startsWith('./connectors/')) {
            const provider = val.replace('./connectors/', '').replace('.connector.js', '');
            i.setModuleSpecifier(`./providers/${provider}/${provider}.connector.js`);
        }
    });
}

const deliveryService = project.getSourceFile('src/modules/connectors/delivery/delivery.service.ts');
if (deliveryService) {
    deliveryService.getImportDeclarations().forEach(i => {
        const val = i.getModuleSpecifierValue();
        if (val === '../connectors/base.connector.js') i.setModuleSpecifier('../shared/base.connector.js');
    });
}

// Fix imports in providers (they moved down one level)
// src/modules/connectors/providers/slack/slack.connector.ts
const providerFiles = project.getSourceFiles().filter(f => f.getFilePath().includes('/providers/'));
providerFiles.forEach(f => {
    f.getImportDeclarations().forEach(i => {
        const val = i.getModuleSpecifierValue();
        // they were in `src/modules/connectors/connectors/`, so `../types.js` is now `../../types.js`
        if (val === '../types.js') {
            i.setModuleSpecifier('../../types.js');
        } else if (val === './base.connector.js') {
            i.setModuleSpecifier('../../shared/base.connector.js');
        } else if (val === './http.js') {
            i.setModuleSpecifier('../../shared/http.js');
        } else if (val.startsWith('../../../config')) {
            // email.connector.ts uses `../../../config/env.js` -> `../../../../config/env.js`
            i.setModuleSpecifier(val.replace('../../../', '../../../../'));
        }
    });
});

// base.connector.ts and http.ts moved from `connectors/connectors/` to `connectors/shared/`
// the relative depth is the same.
project.saveSync();
console.log('Fixed imports for providers');
