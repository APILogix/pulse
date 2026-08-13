export interface ValidationIssue {
    severity: 'error' | 'warning';
    code: string;
    message: string;
    featureKey?: string;
    planKey?: string;
    details?: Record<string, unknown>;
}
export interface CatalogValidationReport {
    timestamp: string;
    totalPlans: number;
    totalFeatures: number;
    totalEntitlementsChecked: number;
    supportedConnectorsCount: number;
    supportedConnectors: string[];
    issues: ValidationIssue[];
    isValid: boolean;
    summary: {
        errorsCount: number;
        warningsCount: number;
        monotonicityPassed: boolean;
        matrixCompletenessPercent: number;
    };
}
export declare class BillingCatalogValidator {
    /**
     * Run full catalog validation and return report.
     */
    validate(): CatalogValidationReport;
    /**
     * Validate and export machine-readable report to a file.
     */
    generateReportFile(outputPath: string): CatalogValidationReport;
}
export declare const catalogValidator: BillingCatalogValidator;
//# sourceMappingURL=catalog-validator.d.ts.map