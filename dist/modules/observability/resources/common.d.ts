/**
 * Common field definitions shared by every canonical `events_*` table.
 *
 * The Log DB migrations give every event table the same storage core
 * (organization_id, project_id, environment, trace/span/session/user ids,
 * service/endpoint/release, severity, timestamp, JSONB attributes/metadata/
 * payload, …). Resources spread {@link commonFields} and add signal-specific
 * fields on top, so filtering/search/projection stay consistent everywhere.
 */
import type { FieldDef } from '../query-engine/field-registry.js';
export declare const SEVERITY_VALUES: readonly ["debug", "info", "warning", "error", "critical", "fatal"];
/** Field definitions present on every telemetry resource. */
export declare const commonFields: Record<string, FieldDef>;
/** Search key aliases common to every resource. */
export declare const commonSearchAliases: Record<string, string>;
/**
 * Build a resource `mapRow` that normalizes pg output: drops the internal
 * cursor columns, coerces the given numeric columns from pg's string form, and
 * leaves JSONB (already parsed by pg) and everything else intact. Works with
 * dynamic field projection because it only touches keys that are present.
 */
export declare function makeMapRow(numericFields: readonly string[]): (row: Record<string, unknown>) => Record<string, unknown>;
//# sourceMappingURL=common.d.ts.map