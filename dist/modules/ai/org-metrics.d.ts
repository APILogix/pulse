export interface ParsedMonitoringTimeRange {
    from: Date;
    to: Date;
    expression: string;
}
/** Parses bounded UTC monitoring ranges without sending user text to a model. */
export declare function parseNaturalTimeRange(question: string, now?: Date): ParsedMonitoringTimeRange | null;
//# sourceMappingURL=org-metrics.d.ts.map