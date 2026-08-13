import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

describe('Platform-Wide API Response Contract Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('verifies 404 response matches canonical error contract envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/non-existent-endpoint-test-route',
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);

    expect(body).toHaveProperty('success', false);
    expect(body).toHaveProperty('data', null);
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
    expect(body).toHaveProperty('requestId');
    expect(typeof body.requestId).toBe('string');
  });

  it('verifies 400 validation response matches canonical error contract envelope', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { invalid_body: true },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);

    expect(body).toHaveProperty('success', false);
    expect(body).toHaveProperty('data', null);
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
    expect(body).toHaveProperty('requestId');
  });

  it('verifies health check endpoint returns valid response contract', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toBeDefined();
  });
});
