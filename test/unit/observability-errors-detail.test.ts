import { describe, it, expect } from 'vitest';
import { errorsResource } from '../../src/modules/observability/resources/errors.resource.js';
import { isPublicField, resolveField } from '../../src/modules/observability/query-engine/field-registry.js';
import { isErrorPublicId, assertErrorPublicId, isErrorGroupPublicId, isTracePublicId } from '../../src/modules/observability/public-id.js';

describe('Error Observability Public ID Contract', () => {
  it('defines errorGroupPublicId and tracePublicId in errorsResource fields', () => {
    expect(errorsResource.fields.errorGroupPublicId).toBeDefined();
    expect(errorsResource.fields.errorGroupPublicId.projectable).toBe(true);
    expect(errorsResource.fields.errorGroupPublicId.filterable).toBe(true);
    expect(errorsResource.fields.errorGroupPublicId.searchable).toBe(true);

    expect(errorsResource.fields.tracePublicId).toBeDefined();
    expect(errorsResource.fields.tracePublicId.projectable).toBe(true);
  });

  it('includes errorGroupPublicId and tracePublicId in defaultProjection', () => {
    expect(errorsResource.defaultProjection).toContain('id');
    expect(errorsResource.defaultProjection).toContain('publicId');
    expect(errorsResource.defaultProjection).toContain('errorGroupId');
    expect(errorsResource.defaultProjection).toContain('errorGroupPublicId');
    expect(errorsResource.defaultProjection).toContain('traceId');
    expect(errorsResource.defaultProjection).toContain('tracePublicId');
  });

  it('includes searchAliases for error group public IDs', () => {
    expect(errorsResource.searchAliases?.errorGroupPublicId).toBe('errorGroupPublicId');
    expect(errorsResource.searchAliases?.error_group_public_id).toBe('errorGroupPublicId');
    expect(errorsResource.searchAliases?.group).toBe('errorGroupPublicId');
  });

  it('validates canonical ERR, ISS, and TRC public IDs', () => {
    expect(isErrorPublicId('ERR-000000169')).toBe(true);
    expect(isErrorPublicId('ISS-000000042')).toBe(false);
    expect(isErrorGroupPublicId('ISS-000000042')).toBe(true);
    expect(isTracePublicId('TRC-000000001')).toBe(true);

    expect(() => assertErrorPublicId('ERR-000000169')).not.toThrow();
    expect(() => assertErrorPublicId('27470483-8189-4717-92e5-229fa46ec578')).toThrow();
  });

  it('verifies public ID field resolution for error table queries', () => {
    const errorGroupDef = resolveField(errorsResource, 'errorGroupPublicId');
    expect(errorGroupDef.expr).toContain('error_groups');
    expect(errorGroupDef.expr).toContain('public_id');

    const traceDef = resolveField(errorsResource, 'tracePublicId');
    expect(traceDef.expr).toContain('events_traces');
    expect(traceDef.expr).toContain('public_id');
  });
});
