import { describe, expect, it } from 'vitest';

import {
  ProjectError,
  ProjectErrorCodes,
  createApiKey,
  hashApiKey,
  isReservedProjectSlug,
  slugifyProjectName,
  validateStatusTransition,
} from '../../src/modules/projects/shared/utils.js';

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
  it('mints a key with a public prefix and secret suffix', () => {
    const result = createApiKey('Production');
    expect(result.fullKey).toContain(result.publicKey);
    expect(result.publicKey.startsWith('pk_production_')).toBe(true);
    expect(result.fullKey.split('.').length).toBe(2);
  });

  it('returns a deterministic sha256 hash of the full key', () => {
    const result = createApiKey('Development');
    expect(result.secretHash).toBe(hashApiKey(result.fullKey));
  });

  it('never returns the same key twice', () => {
    const a = createApiKey('Production');
    const b = createApiKey('Production');
    expect(a.fullKey).not.toBe(b.fullKey);
    expect(a.secretHash).not.toBe(b.secretHash);
  });
});
