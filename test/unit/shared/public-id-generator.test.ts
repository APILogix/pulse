import { describe, it, expect } from 'vitest';
import {
  formatPublicId,
  isPublicId,
  extractPublicIdPrefix,
  PUBLIC_ID_PREFIXES,
  generatePublicId,
} from '../../../src/shared/utils/public-id-generator.js';

describe('PublicIdGenerator Utility', () => {
  it('formats integer sequence numbers into zero-padded public IDs', () => {
    expect(formatPublicId('REQ', 1)).toBe('REQ-000000001');
    expect(formatPublicId('ERR', 42)).toBe('ERR-000000042');
    expect(formatPublicId('ISS', 12345)).toBe('ISS-000012345');
    expect(formatPublicId('TRC', 999999999)).toBe('TRC-999999999');
  });

  it('validates canonical Public ID formats', () => {
    expect(isPublicId('REQ-000000001')).toBe(true);
    expect(isPublicId('ERR-000000042')).toBe(true);
    expect(isPublicId('ISS-000012345')).toBe(true);
    expect(isPublicId('TRC-000000100')).toBe(true);
    expect(isPublicId('SPN-000000005')).toBe(true);
    expect(isPublicId('LOG-000000001')).toBe(true);
    expect(isPublicId('MSG-000000001')).toBe(true);
    expect(isPublicId('SES-000000001')).toBe(true);
    expect(isPublicId('RPL-000000001')).toBe(true);
    expect(isPublicId('PRF-000000001')).toBe(true);
    expect(isPublicId('CRN-000000001')).toBe(true);

    // Invalid formats
    expect(isPublicId('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    expect(isPublicId('INVALID-123')).toBe(false);
    expect(isPublicId('REQ-abc')).toBe(false);
    expect(isPublicId(null)).toBe(false);
    expect(isPublicId(undefined)).toBe(false);
  });

  it('extracts prefixes correctly', () => {
    expect(extractPublicIdPrefix('REQ-000000001')).toBe('REQ');
    expect(extractPublicIdPrefix('ISS-000000002')).toBe('ISS');
    expect(extractPublicIdPrefix('invalid')).toBe(null);
  });

  it('contains prefix constants for all 12 user-facing entities', () => {
    expect(Object.keys(PUBLIC_ID_PREFIXES)).toHaveLength(12);
    expect(PUBLIC_ID_PREFIXES.requests).toBe('REQ');
    expect(PUBLIC_ID_PREFIXES.errors).toBe('ERR');
    expect(PUBLIC_ID_PREFIXES.errorGroups).toBe('ISS');
    expect(PUBLIC_ID_PREFIXES.traces).toBe('TRC');
    expect(PUBLIC_ID_PREFIXES.spans).toBe('SPN');
    expect(PUBLIC_ID_PREFIXES.logs).toBe('LOG');
    expect(PUBLIC_ID_PREFIXES.messages).toBe('MSG');
    expect(PUBLIC_ID_PREFIXES.sessions).toBe('SES');
    expect(PUBLIC_ID_PREFIXES.replays).toBe('RPL');
    expect(PUBLIC_ID_PREFIXES.profiles).toBe('PRF');
    expect(PUBLIC_ID_PREFIXES.cronCheckins).toBe('CRN');
    expect(PUBLIC_ID_PREFIXES.metrics).toBe('MTR');
  });

  it('generates valid public IDs via generatePublicId', () => {
    const reqId = generatePublicId('REQ');
    expect(isPublicId(reqId)).toBe(true);
    expect(reqId.startsWith('REQ-')).toBe(true);

    const mtrId = generatePublicId('MTR', 42);
    expect(mtrId).toBe('MTR-000000042');
    expect(isPublicId(mtrId)).toBe(true);
  });
});

import {
  isRequestPublicId,
  assertRequestPublicId,
  isErrorPublicId,
  assertErrorPublicId,
  isErrorGroupPublicId,
  assertErrorGroupPublicId,
  isTracePublicId,
  assertTracePublicId,
} from '../../../src/modules/observability/public-id.js';

describe('Observability Module Public ID Validators', () => {
  it('validates request public IDs (REQ-...)', () => {
    expect(isRequestPublicId('REQ-000000001')).toBe(true);
    expect(isRequestPublicId('ERR-000000001')).toBe(false);
    expect(isRequestPublicId('invalid')).toBe(false);
    expect(() => assertRequestPublicId('REQ-000000001')).not.toThrow();
    expect(() => assertRequestPublicId('ERR-000000001')).toThrow('Invalid request public id');
  });

  it('validates error public IDs (ERR-...)', () => {
    expect(isErrorPublicId('ERR-000000169')).toBe(true);
    expect(isErrorPublicId('REQ-000000001')).toBe(false);
    expect(isErrorPublicId('ISS-000000042')).toBe(false);
    expect(() => assertErrorPublicId('ERR-000000169')).not.toThrow();
    expect(() => assertErrorPublicId('REQ-000000001')).toThrow('Invalid error public id');
  });

  it('validates error group public IDs (ISS-...)', () => {
    expect(isErrorGroupPublicId('ISS-000000042')).toBe(true);
    expect(isErrorGroupPublicId('ERR-000000169')).toBe(false);
    expect(() => assertErrorGroupPublicId('ISS-000000042')).not.toThrow();
    expect(() => assertErrorGroupPublicId('ERR-000000169')).toThrow('Invalid error group public id');
  });

  it('validates trace public IDs (TRC-...)', () => {
    expect(isTracePublicId('TRC-000000001')).toBe(true);
    expect(isTracePublicId('REQ-000000001')).toBe(false);
    expect(() => assertTracePublicId('TRC-000000001')).not.toThrow();
    expect(() => assertTracePublicId('REQ-000000001')).toThrow('Invalid trace public id');
  });
});

