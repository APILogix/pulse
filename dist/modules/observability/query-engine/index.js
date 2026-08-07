/**
 * Unified Explorer Query Engine — public surface.
 *
 * Import from here rather than reaching into individual files. The engine is
 * the single backend entry point for querying observability data.
 */
export * from './types.js';
export * from './errors.js';
export { ParamBag, ALL_OPERATORS, COMPARISON_OPERATORS, TEXT_OPERATORS, buildOperatorFragment, coerceScalar, } from './operators.js';
export { ResourceRegistry, resolveField, operatorsForField, defaultOperatorsFor, buildFacets, buildPublicProjection, buildDetailProjection, projectPublicRow, } from './field-registry.js';
export { encodeCursor, decodeCursor } from './cursor.js';
export { parseSearch } from './search-parser.js';
export { buildExplorerQuery, resolveTimeRange, RawExplorerQuerySchema, RANGE_MS, } from './query-schema.js';
export { buildListStatement, buildSummaryStatement, buildStatisticsStatement, buildTimelineStatement, buildScopePredicates, } from './sql-builder.js';
export { ExplorerQueryEngine } from './engine.js';
//# sourceMappingURL=index.js.map