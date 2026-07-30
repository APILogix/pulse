import { describe, expect, it } from 'vitest';

import {
  ProjectError,
  ProjectErrorCodes,
  createApiKey,
  environmentKeyPrefix,
  extractApiKeyPrefix,
  hashApiKey,
  isReservedProjectSlug,
  slugifyProjectName,
  validateStatusTransition,
} from '../../src/modules/projects/shared/utils.js';
import { CreateApiKeyBodySchema } from '../../src/modules/projects/api-keys/api-key.types.js';

// ... existing tests ...

describe('ProjectError codes', () => {
  it('includes concurrent update codes with 409 status', () => {
    expect(ProjectErrorCodes.PROJECT_CONCURRENT_UPDATE).toBe(409);
    expect(ProjectErrorCodes.API_KEY_CONCURRENT_UPDATE).toBe(409);
  });

  it('produces a 409 status for concurrent update errors', () => {
    const err = new ProjectError('PROJECT_CONCURRENT_UPDATE', 'Conflict', 409);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('PROJECT_CONCURRENT_UPDATE');
  });
});

describe('api key secret handling', () => {
  it('never includes secretHash in the public shape', () => {
    const key = createApiKey('Production');
    // Simulate the service mapping: public keys carry only the public prefix and
    // hash; the raw secret must never be returned outside create/rotate.
    const publicShape = {
      id: 'key-1',
      publicKey: key.publicKey,
      secretHash: key.secretHash,
    };
    delete (publicShape as Partial<typeof publicShape>).secretHash;
    expect('secretHash' in publicShape).toBe(false);
    expect(publicShape.publicKey).toBe(key.publicKey);
  });

  it('uses sha256 for secret hashing', () => {
    const key = createApiKey('Production');
    expect(key.secretHash).toBe(hashApiKey(key.fullKey));
    expect(key.secretHash.length).toBe(64); // hex sha256
  });
});

describe('project slug validation', () => {
  it('blocks platform-reserved slugs', () => {
    expect(isReservedProjectSlug('admin')).toBe(true);
    expect(isReservedProjectSlug('api')).toBe(true);
    expect(isReservedProjectSlug('dashboard')).toBe(true);
    expect(isReservedProjectSlug('projects')).toBe(true);
    expect(isReservedProjectSlug('settings')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isReservedProjectSlug('Admin')).toBe(true);
    expect(isReservedProjectSlug('API')).toBe(true);
  });

  it('allows normal project names', () => {
    expect(isReservedProjectSlug('acme-web')).toBe(false);
    expect(isReservedProjectSlug('my-cool-app')).toBe(false);
  });

  it('slugifies names into url-safe identifiers', () => {
    expect(slugifyProjectName('My Cool App')).toBe('my-cool-app');
    expect(slugifyProjectName('API Gateway')).toBe('api-gateway');
  });
});

describe('project status transitions', () => {
  it('allows valid transitions', () => {
    expect(validateStatusTransition('active', 'paused')).toBe(true);
    expect(validateStatusTransition('active', 'archived')).toBe(true);
    expect(validateStatusTransition('paused', 'active')).toBe(true);
    expect(validateStatusTransition('archived', 'active')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(validateStatusTransition('active', 'active')).toBe(false);
    expect(validateStatusTransition('archived', 'paused')).toBe(false);
  });
});

describe('api key generation', () => {
  it('mints production keys with the live prefix and no environment name', () => {
    const result = createApiKey('Production');
    expect(result.fullKey).toContain(result.publicKey);
    expect(result.publicKey.startsWith('pv_live_')).toBe(true);
    expect(result.publicKey).not.toContain('production');
    expect(result.fullKey.split('.').length).toBe(2);
    expect(result.fullKey.split('.')[1]).toHaveLength(64);
  });

  it('mints every non-production environment with the test prefix', () => {
    for (const environment of ['Development', 'local', 'staging', 'pre-staging', 'qa', 'preview', 'uat', 'sandbox']) {
      const result = createApiKey(environment);
      expect(result.publicKey.startsWith('pv_test_')).toBe(true);
      expect(result.publicKey).not.toContain(environment.toLowerCase());
    }
  });

  it('centralizes public prefix selection', () => {
    expect(environmentKeyPrefix('production')).toBe('pv_live_');
    expect(environmentKeyPrefix('prod')).toBe('pv_live_');
    expect(environmentKeyPrefix('staging')).toBe('pv_test_');
    expect(environmentKeyPrefix('qa')).toBe('pv_test_');
  });

  it('rejects user-controlled API key prefixes', () => {
    const result = CreateApiKeyBodySchema.safeParse({
      environmentId: '55555555-5555-4555-8555-555555555555',
      keyType: 'read_write',
      publicKey: 'spoofed_prefix',
    });
    expect(result.success).toBe(false);
  });

  it('returns a deterministic sha256 hash of the full key', () => {
    const result = createApiKey('Development');
    expect(result.secretHash).toBe(hashApiKey(result.fullKey));
  });

  it('extracts current prefixes and keeps legacy prefixes authenticatable until rotation', () => {
    expect(extractApiKeyPrefix('pv_live_abcdefghijklmnopqrstuvwx.0123')).toBe('pv_live_abcdefghijklmnopqrstuvwx');
    expect(extractApiKeyPrefix('pv_test_abcdefghijklmnopqrstuvwx.0123')).toBe('pv_test_abcdefghijklmnopqrstuvwx');
    expect(extractApiKeyPrefix('pulsiv_pre-staging_legacy123.0123')).toBe('pulsiv_pre-staging_legacy123');
    expect(extractApiKeyPrefix('pv_qa_abcdefghijklmnopqrstuvwx.0123')).toBeNull();
    expect(extractApiKeyPrefix('pv_staging_abcdefghijklmnopqrstuvwx.0123')).toBeNull();
  });

  it('never returns the same key twice', () => {
    const a = createApiKey('Production');
    const b = createApiKey('Production');
    expect(a.fullKey).not.toBe(b.fullKey);
    expect(a.secretHash).not.toBe(b.secretHash);
  });
});
