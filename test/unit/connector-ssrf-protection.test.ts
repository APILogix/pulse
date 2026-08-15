import { describe, expect, it } from 'vitest';
import { httpRequest } from '../../src/modules/connectors/shared/http.js';
import { ConnectorDeliveryError } from '../../src/modules/connectors/types.js';

describe('Connector SSRF Protection', () => {
  it('blocks link-local / AWS metadata IP 169.254.169.254', async () => {
    await expect(
      httpRequest('http://169.254.169.254/latest/meta-data/'),
    ).rejects.toThrowError(/SSRF protection blocked request/);
  });

  it('blocks loopback address 127.0.0.1', async () => {
    await expect(
      httpRequest('http://127.0.0.1:8080/internal/admin'),
    ).rejects.toThrowError(/SSRF protection blocked request/);
  });

  it('blocks private RFC1918 10.0.0.1', async () => {
    await expect(
      httpRequest('https://10.0.0.1/webhook'),
    ).rejects.toThrowError(/SSRF protection blocked request/);
  });

  it('blocks metadata.google.internal', async () => {
    await expect(
      httpRequest('http://metadata.google.internal/computeMetadata/v1/'),
    ).rejects.toThrowError(/SSRF protection blocked request/);
  });

  it('throws ConnectorDeliveryError with category invalid_config and retryable=false', async () => {
    try {
      await httpRequest('http://169.254.169.254/api');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorDeliveryError);
      const deliveryError = err as ConnectorDeliveryError;
      expect(deliveryError.failureCategory).toBe('invalid_config');
      expect(deliveryError.retryable).toBe(false);
    }
  });
});
