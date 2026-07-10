const { Project } = require('ts-morph');
const fs = require('fs');

const project = new Project();
const repoPath = 'src/modules/connectors/repository.ts';
const sourceFile = project.addSourceFileAtPath(repoPath);

// Create delivery.repository.ts
const deliveryFile = project.createSourceFile('src/modules/connectors/delivery/delivery.repository.ts', sourceFile.getFullText());
const deliveryRepoClass = deliveryFile.getClass('ConnectorRepository');
deliveryRepoClass.rename('DeliveryRepository');
deliveryRepoClass.getMethods().forEach(m => {
    const name = m.getName();
    if (!['withTransaction', 'insertDelivery', 'markDeliverySent', 'markDeliveryRetrying', 'markDeliveryFailed', 'claimRetryableDeliveries', 'listDeliveries', 'insertDeadLetter'].includes(name)) {
        m.remove();
    }
});
// Remove unneeded interfaces from delivery
['CreateConnectorInput'].forEach(name => deliveryFile.getInterface(name)?.remove());
deliveryFile.getVariableStatement('CONNECTOR_COLUMNS')?.remove();
// Fix imports in delivery
deliveryFile.getImportDeclarations().forEach(i => {
    if (i.getModuleSpecifierValue() === './types.js') {
        i.setModuleSpecifier('../types.js');
    }
});

// Create metrics.repository.ts
fs.mkdirSync('src/modules/connectors/metrics', { recursive: true });
const metricsFile = project.createSourceFile('src/modules/connectors/metrics/metrics.repository.ts', sourceFile.getFullText());
const metricsRepoClass = metricsFile.getClass('ConnectorRepository');
metricsRepoClass.rename('ConnectorMetricsRepository');
metricsRepoClass.getMethods().forEach(m => {
    if (!['recordSuccess', 'recordFailure', 'insertHealthCheck'].includes(m.getName())) {
        m.remove();
    }
});
['CreateConnectorInput', 'InsertDeliveryInput'].forEach(name => metricsFile.getInterface(name)?.remove());
metricsFile.getVariableStatement('CONNECTOR_COLUMNS')?.remove();
metricsFile.getImportDeclarations().forEach(i => {
    if (i.getModuleSpecifierValue() === './types.js') {
        i.setModuleSpecifier('../types.js');
    }
});

// Create audit.repository.ts
fs.mkdirSync('src/modules/connectors/audit', { recursive: true });
const auditFile = project.createSourceFile('src/modules/connectors/audit/audit.repository.ts', sourceFile.getFullText());
const auditRepoClass = auditFile.getClass('ConnectorRepository');
auditRepoClass.rename('ConnectorAuditRepository');
auditRepoClass.getMethods().forEach(m => {
    if (!['insertAuditLog'].includes(m.getName())) {
        m.remove();
    }
});
['CreateConnectorInput', 'InsertDeliveryInput'].forEach(name => auditFile.getInterface(name)?.remove());
auditFile.getVariableStatement('CONNECTOR_COLUMNS')?.remove();
auditFile.getImportDeclarations().forEach(i => {
    if (i.getModuleSpecifierValue() === './types.js') {
        i.setModuleSpecifier('../types.js');
    }
});

// Modify core/connector.repository.ts
const coreFile = project.createSourceFile('src/modules/connectors/core/connector.repository.ts', sourceFile.getFullText());
const coreRepoClass = coreFile.getClass('ConnectorRepository');
coreRepoClass.getMethods().forEach(m => {
    const name = m.getName();
    if (!['withTransaction', 'create', 'findById', 'findByIdInternal', 'getByIds', 'list', 'listMonitorable', 'update', 'softDelete', 'setStatus'].includes(name)) {
        m.remove();
    }
});
coreFile.getInterface('InsertDeliveryInput')?.remove();
coreFile.getImportDeclarations().forEach(i => {
    if (i.getModuleSpecifierValue() === './types.js') {
        i.setModuleSpecifier('../types.js');
    }
});

project.saveSync();
console.log('Repositories split successfully');
