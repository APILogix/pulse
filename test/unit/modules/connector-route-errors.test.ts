import { beforeAll, describe, expect, it } from 'vitest';
import { CreateConnectorSchema } from '../../../src/modules/connectors/types.js';
import type { connectorRouteErrorResponse as ConnectorRouteErrorResponseFn } from '../../../src/modules/connectors/routes.js';

let connectorRouteErrorResponse: typeof ConnectorRouteErrorResponseFn;

beforeAll(async () => {
  process.env.NODE_ENV = 'development';
  ({ connectorRouteErrorResponse } = await import('../../../src/modules/connectors/routes.js'));
});

describe('connector route error mapping', () => {
  it('maps Zod validation failures to a typed 400 response', () => {
    let error: unknown;
    try {
      CreateConnectorSchema.parse({
        name: 'alerts',
        type: 'webhook',
        config: { url: 'https://example.com/hook' },
        unknownField: true,
      });
    } catch (err) {
      error = err;
    }

    const response = connectorRouteErrorResponse(error);

    expect(response.statusCode).toBe(400);
    expect(response.payload).toMatchObject({
      success: false,
      error: {
        code: 'CONNECTOR_VALIDATION_ERROR',
        message: 'Connector request validation failed',
      },
    });
    expect(response.payload.error.details).toEqual({
      issues: [expect.objectContaining({
        code: 'unrecognized_keys',
        message: expect.stringContaining('unknownField'),
      })],
    });
  });
});
