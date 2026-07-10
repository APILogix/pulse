const { Project } = require('ts-morph');
const fs = require('fs');

const project = new Project();
const typesFile = project.addSourceFileAtPath('src/modules/connectors/types.ts');

const deliveryNodes = [
    'DeliveryStatusSchema',
    'DeliveryStatus',
    'FailureCategorySchema',
    'FailureCategory',
    'DeliveryResult',
    'DeliveryRow',
    'DeliveryDto',
    'DispatchSummary',
    'ConnectorDeliveryError'
];

let deliveryCode = `import { z } from 'zod';\nimport { AppError } from '../../../shared/errors/app-error.js';\nimport type { NotificationSeverity } from '../core/connector.types.js';\n\n`;

for (const nodeName of deliveryNodes) {
    const decls = typesFile.getExportedDeclarations().get(nodeName);
    if (decls) {
        for (const decl of decls) {
            // Check if it's a type alias vs variable statement vs interface
            const stmt = decl.getParentIfKind(242) || decl.getParentIfKind(243) || decl.getParentIfKind(240) || decl;
            // Get the full text of the statement
            let text = decl.getText();
            if (decl.getKindName() === 'VariableDeclaration') {
                text = decl.getParent().getParent().getText();
            }
            deliveryCode += text + '\n\n';
            
            // Remove from original
            if (decl.getKindName() === 'VariableDeclaration') {
                decl.getParent().getParent().remove();
            } else {
                decl.remove();
            }
        }
    }
}

// Write the new files
fs.writeFileSync('src/modules/connectors/delivery/delivery.types.ts', deliveryCode);

// Add import to core
typesFile.insertImportDeclaration(0, {
    namedImports: [{ name: 'FailureCategory' }],
    moduleSpecifier: '../delivery/delivery.types.js'
});

// Write core
fs.writeFileSync('src/modules/connectors/core/connector.types.ts', typesFile.getFullText());
console.log('Done splitting types with ts-morph');
