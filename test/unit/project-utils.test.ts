import { describe, expect, it } from 'vitest';

import {
  createApiKey,
  hashApiKey,
  isReservedProjectSlug,
  slugifyProjectName,
  validateStatusTransition,
} from '../../src/modules/projects/shared/utils.js';

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
