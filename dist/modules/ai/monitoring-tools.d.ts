import type { AnalyticsService } from '../analytics/service.js';
import type { AlertingService } from '../alerting/service.js';
import type { EventAnalyticsService } from '../event-analytics/service.js';
import type { AccessibleProject, ChatToolCallRecord } from './repository.js';
export interface MonitoringSource {
    sourceId: string;
    sourceType: 'tool';
    title: string;
    reference: string;
    content: string;
    observedAt: string;
}
export interface MonitoringToolResult {
    sources: MonitoringSource[];
    calls: ChatToolCallRecord[];
}
interface ToolInput {
    tenantId: string;
    question: string;
    projects: AccessibleProject[];
    requestedProjectId?: string;
    from: Date;
    to: Date;
    timeExpression: string;
}
export declare class MonitoringTools {
    private readonly analytics;
    private readonly alerting;
    private readonly eventAnalytics;
    constructor(analytics: AnalyticsService, alerting: AlertingService, eventAnalytics: EventAnalyticsService);
    execute(input: ToolInput): Promise<MonitoringToolResult>;
    private capture;
    private withTimeout;
    private addResult;
}
export {};
//# sourceMappingURL=monitoring-tools.d.ts.map