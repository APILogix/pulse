import type { CreateRuleBody } from '../rules/rules.types.js';
export interface AlertRuleTemplate {
    key: string;
    name: string;
    description: string;
    category: 'default' | 'observability' | 'ai' | 'billing' | 'security' | 'integration';
    rule: CreateRuleBody;
}
export declare const ALERT_RULE_TEMPLATES: readonly AlertRuleTemplate[];
export declare function listAlertRuleTemplates(): readonly AlertRuleTemplate[];
export declare function getAlertRuleTemplate(key: string): AlertRuleTemplate | null;
//# sourceMappingURL=rule-templates.d.ts.map