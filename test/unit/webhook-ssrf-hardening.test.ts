import { describe, expect, it, vi } from 'vitest';
import * as dns from 'dns';
import { validateWebhookUrl, validateWebhookUrlAsync } from '../../src/shared/utils/ssrf.js';
import { httpRequest } from '../../src/modules/connectors/shared/http.js';
import { ConnectorDeliveryError } from '../../src/modules/connectors/types.js';

describe('Webhook SSRF Hardening (Phase 4)', () => {
  describe('Static URL Lexical Validation', () => {
    it('blocks private IPv4 subnets (RFC 1918)', () => {
      expect(validateWebhookUrl('https://10.0.0.1/hook').safe).toBe(false);
      expect(validateWebhookUrl('https://172.16.0.5/hook').safe).toBe(false);
      expect(validateWebhookUrl('https://192.168.1.100/hook').safe).toBe(false);
    });

    it('blocks loopback and cloud metadata endpoints', () => {
      expect(validateWebhookUrl('https://127.0.0.1/hook').safe).toBe(false);
      expect(validateWebhookUrl('https://169.254.169.254/latest/meta-data').safe).toBe(false);
      expect(validateWebhookUrl('https://metadata.google.internal/computeMetadata').safe).toBe(false);
      expect(validateWebhookUrl('https://localhost/api').safe).toBe(false);
      expect(validateWebhookUrl('https://app.local/api').safe).toBe(false);
      expect(validateWebhookUrl('https://service.internal/api').safe).toBe(false);
    });

    it('rejects URLs containing embedded credentials', () => {
      const res = validateWebhookUrl('https://admin:secret@api.example.com/webhook');
      expect(res.safe).toBe(false);
      expect(res.reason).toContain('credentials');
    });

    it('accepts valid public HTTPS URLs', () => {
      expect(validateWebhookUrl('https://api.example.com/webhook').safe).toBe(true);
      expect(validateWebhookUrl('https://hooks.slack.com/services/T00/B00/X00').safe).toBe(true);
    });
  });

  describe('Asynchronous DNS Resolution & Anti-Rebinding', () => {
    it('blocks hostnames resolving to loopback (127.0.0.1)', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
        { address: '127.0.0.1', family: 4 },
      ] as any);

      const res = await validateWebhookUrlAsync('https://rebind-test.attacker.com/webhook');
      expect(res.safe).toBe(false);
      expect(res.reason).toContain('loopback');
      vi.restoreAllMocks();
    });

    it('blocks hostnames resolving to AWS metadata (169.254.169.254)', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
        { address: '169.254.169.254', family: 4 },
      ] as any);

      const res = await validateWebhookUrlAsync('https://metadata-rebind.attacker.com/webhook');
      expect(res.safe).toBe(false);
      expect(res.reason).toContain('169.254.169.254');
      vi.restoreAllMocks();
    });

    it('blocks hostnames resolving to private 10.x.x.x networks', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
        { address: '10.200.1.5', family: 4 },
      ] as any);

      const res = await validateWebhookUrlAsync('https://internal-rebind.attacker.com/webhook');
      expect(res.safe).toBe(false);
      expect(res.reason).toContain('private');
      vi.restoreAllMocks();
    });

    it('permits hostnames resolving to valid public IP addresses', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
      ] as any);

      const res = await validateWebhookUrlAsync('https://example.com/webhook');
      expect(res.safe).toBe(true);
      vi.restoreAllMocks();
    });
  });

  describe('Integration with httpRequest', () => {
    it('throws ConnectorDeliveryError with invalid_config when SSRF is triggered', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
        { address: '127.0.0.1', family: 4 },
      ] as any);

      await expect(
        httpRequest('https://malicious-rebind.test/webhook', { timeoutMs: 1000 }),
      ).rejects.toThrow(ConnectorDeliveryError);

      vi.restoreAllMocks();
    });
  });
});
