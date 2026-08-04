/**
 * Unified Explorer Query Engine — public surface.
 *
 * Import from here rather than reaching into individual files. The engine is
 * the single backend entry point for querying observability data.
 */
export * from './types.js';
export * from './errors.js';
export {
  ParamBag,
  ALL_OPERATORS,
  COMPARISON_OPERATORS,
  TEXT_OPERATORS,
  buildOperatorFragment,
  coerceScalar,
} from './operators.js';
export {
  type FieldDef,
  type ExplorerResource,
  type ResolvedField,
  ResourceRegistry,
  resolveField,
  operatorsForField,
  defaultOperatorsFor,
  buildFacets,
} from './field-registry.js';
export { encodeCursor, decodeCursor, type CursorPayload } from './cursor.js';
export { parseSearch, type ParsedSearch } from './search-parser.js';
export {
  buildExplorerQuery,
  resolveTimeRange,
  RawExplorerQuerySchema,
  RANGE_MS,
  type RawExplorerQuery,
} from './query-schema.js';
export {
  buildListStatement,
  buildSummaryStatement,
  buildStatisticsStatement,
  buildTimelineStatement,
  buildScopePredicates,
  type BuiltStatement,
  type BuiltListStatement,
  type TimelineInterval,
} from './sql-builder.js';
export { ExplorerQueryEngine, type QueryExecutor } from './engine.js';
