const { Project } = require('ts-morph');
const fs = require('fs');
const path = require('path');

const project = new Project();
const typesFile = project.addSourceFileAtPath('src/modules/alerting/types.ts');

const domains = {
    'rules': ['AlertSeveritySchema', 'AlertSeverity', 'ConditionTypeSchema', 'ConditionType', 'ConditionOperatorSchema', 'ConditionOperator', 'ActionTypeSchema', 'ActionType', 'AGGREGATE_FUNCTIONS', 'RuleConditionSchema', 'RuleConditionInput', 'RuleActionSchema', 'RuleActionInput', 'CreateRuleSchema', 'CreateRuleBody', 'UpdateRuleSchema', 'UpdateRuleBody', 'ListRulesQuerySchema', 'ListRulesQuery', 'TestRuleSchema', 'TestRuleBody', 'AlertRuleRow', 'AlertRuleConditionRow', 'AlertRuleActionRow', 'OrgRuleParamsSchema'],
    'events': ['AlertEventStatusSchema', 'AlertEventStatus', 'DeliveryAttemptStatusSchema', 'DeliveryAttemptStatus', 'BatchStatusSchema', 'BatchStatus', 'HistoryActionSchema', 'HistoryAction', 'IngestEventSchema', 'IngestEventBody', 'ListEventsQuerySchema', 'ListEventsQuery', 'AcknowledgeEventSchema', 'AcknowledgeEventBody', 'ResolveEventSchema', 'ResolveEventBody', 'AlertEventRow', 'AlertBatchRow', 'AlertDeliveryAttemptRow', 'OrgEventParamsSchema'],
    'silences': ['CreateSilenceSchema', 'CreateSilenceBody', 'SilenceFromEventSchema', 'SilenceFromEventBody', 'ListSilencesQuerySchema', 'ListSilencesQuery', 'AlertSilenceRow'],
    'policies': ['CreateEscalationPolicySchema', 'CreateEscalationPolicyBody', 'UpsertEscalationStepSchema', 'UpsertEscalationStepBody', 'AlertEscalationPolicyRow', 'AlertEscalationStepRow', 'OrgPolicyParamsSchema', 'OrgPolicyStepParamsSchema'],
    'templates': ['CreateTemplateSchema', 'CreateTemplateBody', 'UpdateTemplateSchema', 'UpdateTemplateBody', 'PreviewTemplateSchema', 'PreviewTemplateBody', 'AlertTemplateRow'],
    'routing': ['RoutingConditionsSchema', 'RoutingConditions', 'CreateRoutingRuleSchema', 'CreateRoutingRuleBody', 'UpdateRoutingRuleSchema', 'UpdateRoutingRuleBody', 'TestRoutingSchema', 'TestRoutingBody', 'AlertRoutingRuleRow'],
    'metrics': ['MetricGranularitySchema', 'MetricGranularity', 'MetricsQuerySchema', 'MetricsQuery', 'AlertMetricRow']
};

for (const [domain, nodes] of Object.entries(domains)) {
    fs.mkdirSync(`src/modules/alerting/${domain}`, { recursive: true });
    
    let domainCode = `import { z } from 'zod';\nimport { AppError } from '../../../shared/errors/app-error.js';\n\n`;
    
    for (const nodeName of nodes) {
        const decls = typesFile.getExportedDeclarations().get(nodeName);
        if (decls) {
            for (const decl of decls) {
                const stmt = decl.getParentIfKind(242) || decl.getParentIfKind(243) || decl.getParentIfKind(240) || decl;
                let text = decl.getText();
                if (decl.getKindName() === 'VariableDeclaration') {
                    text = decl.getParent().getParent().getText();
                    decl.getParent().getParent().remove();
                } else {
                    decl.remove();
                }
                domainCode += text + '\n\n';
            }
        }
    }
    
    fs.writeFileSync(`src/modules/alerting/${domain}/${domain}.types.ts`, domainCode);
}

// Add imports to the original types.ts so existing code still works
for (const domain of Object.keys(domains)) {
    typesFile.addExportDeclaration({ moduleSpecifier: `./${domain}/${domain}.types.js` });
}

fs.writeFileSync('src/modules/alerting/types.ts', typesFile.getFullText());
console.log('Alerting types split successfully');
