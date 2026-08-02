/**
 * Operator layer — turns a validated {@link FilterClause} into a parameterized
 * SQL fragment. Nothing here interpolates a value into SQL text; every value
 * is bound through {@link ParamBag}. Column expressions are resolved from the
 * server-defined field registry, never from raw user input.
 */
import type { FieldType, FilterOperator } from './types.js';
/**
 * Collects bound parameters and hands out positional placeholders (`$1`, `$2`
 * …). One bag is used per built statement so numbering stays consistent.
 */
export declare class ParamBag {
    private readonly values;
    /** Bind a value and return its placeholder token. */
    next(value: unknown): string;
    get params(): unknown[];
    get size(): number;
}
/** All operators, exported for facet metadata and validation. */
export declare const ALL_OPERATORS: readonly FilterOperator[];
/** Operators that only make sense for ordered (numeric/temporal) fields. */
export declare const COMPARISON_OPERATORS: readonly FilterOperator[];
/** Operators that only make sense for text fields. */
export declare const TEXT_OPERATORS: readonly FilterOperator[];
/**
 * Coerce and validate a raw value against a field type. Throws a
 * {@link QueryValidationError} (400) on any mismatch so bad input never reaches
 * the database as a runtime cast error.
 */
export declare function coerceScalar(value: unknown, type: FieldType, field: string): unknown;
/**
 * Build a boolean SQL predicate for an operator against a resolved column
 * expression. `columnExpr` is trusted (registry-derived); every value is bound.
 */
export declare function buildOperatorFragment(columnExpr: string, op: FilterOperator, type: FieldType, value: unknown, field: string, bag: ParamBag): string;
//# sourceMappingURL=operators.d.ts.map