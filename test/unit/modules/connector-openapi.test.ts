import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

function loadSpec() {
  return parse(readFileSync('docs/connectors.openapi.yaml', 'utf8')) as Record<string, any>;
}

function resolveRef(doc: Record<string, any>, ref: string): unknown {
  let current: unknown = doc;
  for (const part of ref.slice(2).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    current = (current as Record<string, unknown> | undefined)?.[part];
  }
  return current;
}

describe('connectors OpenAPI contract', () => {
  it('resolves every local reference', () => {
    const doc = loadSpec();
    const refs: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (typeof obj.$ref === 'string') refs.push(obj.$ref);
        Object.values(obj).forEach(walk);
      }
    };

    walk(doc);

    for (const ref of refs.filter((r) => r.startsWith('#/'))) {
      expect(resolveRef(doc, ref), ref).not.toBeUndefined();
    }
  });

  it('documents concrete response bodies for all non-empty connector responses', () => {
    const doc = loadSpec();
    const missing: string[] = [];

    for (const [path, item] of Object.entries(doc.paths as Record<string, Record<string, any>>)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!operation?.responses) continue;
        for (const [status, response] of Object.entries(operation.responses as Record<string, any>)) {
          if (status === '204') continue;
          if (response.$ref) continue;
          if (!response.content) missing.push(`${method.toUpperCase()} ${path} ${status}`);
        }
      }
    }

    for (const [name, response] of Object.entries(doc.components.responses as Record<string, any>)) {
      if (!response.content) missing.push(`components.responses.${name}`);
    }

    expect(missing).toEqual([]);
  });
});
