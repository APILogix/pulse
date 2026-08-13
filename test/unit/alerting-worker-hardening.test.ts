import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { env } from '../../src/config/env.js';
import { CONNECTOR_PRIORITY } from '../../src/modules/connectors/job.constants.js';
import { ConnectorGlobalGuards } from '../../src/modules/connectors/runtime-global-guards.js';
import { classifyHttpStatus } from '../../src/modules/connectors/shared/http.js';
import { isConnectorTransportJob } from '../../src/modules/connectors/delivery/transport.types.js';

describe('Enterprise Alert Worker Hardening', () => {
  describe('Provider Concurrency & Priority Bounds', () => {
    it('defines strict priority rankings where CRITICAL > ERROR > WARNING > INFO', () => {
      expect(CONNECTOR_PRIORITY.critical).toBeGreaterThan(CONNECTOR_PRIORITY.error);
      expect(CONNECTOR_PRIORITY.error).toBeGreaterThan(CONNECTOR_PRIORITY.warning);
      expect(CONNECTOR_PRIORITY.warning).toBeGreaterThan(CONNECTOR_PRIORITY.info);
      expect(CONNECTOR_PRIORITY.critical).toBe(100);
      expect(CONNECTOR_PRIORITY.info).toBe(20);
    });

    it('loads provider-specific concurrency settings from environment configuration', () => {
      expect(env.CONNECTOR_CONCURRENCY_SLACK).toBeGreaterThanOrEqual(1);
      expect(env.CONNECTOR_CONCURRENCY_EMAIL).toBeGreaterThanOrEqual(1);
      expect(env.CONNECTOR_CONCURRENCY_WEBHOOK).toBeGreaterThanOrEqual(1);
      expect(env.CONNECTOR_CONCURRENCY_DISCORD).toBeGreaterThanOrEqual(1);
      expect(env.CONNECTOR_CONCURRENCY_TEAMS).toBeGreaterThanOrEqual(1);
      expect(env.CONNECTOR_CONCURRENCY_PAGERDUTY).toBeGreaterThanOrEqual(1);
      expect(env.CONNECTOR_CONCURRENCY_SMS).toBeGreaterThanOrEqual(1);
      expect(env.CONNECTOR_HTTP_CONNECT_TIMEOUT_MS).toBeGreaterThanOrEqual(500);
    });
  });

  describe('Job Contract & Payload Defense', () => {
    it('validates ConnectorTransportJob contract structure', () => {
      const validJob = {
        organizationId: 'org-123',
        notificationJobId: 'job-123',
        connectorId: 'conn-123',
        channelKind: 'slack',
        severity: 'critical',
        idempotencyKey: 'idem-123',
        correlationId: 'corr-123',
        payload: { title: 'Test Alert' },
      };
      expect(isConnectorTransportJob(validJob)).toBe(true);

      const invalidJob = {
        organizationId: 'org-123',
        // missing notificationJobId & connectorId
        channelKind: 'slack',
      };
      expect(isConnectorTransportJob(invalidJob)).toBe(false);
    });
  });

  describe('Retry Classification Taxonomy', () => {
    it('classifies 429 and 5xx as retryable temporary errors', () => {
      const r429 = classifyHttpStatus(429);
      expect(r429.retryable).toBe(true);
      expect(r429.category).toBe('rate_limit');

      const r500 = classifyHttpStatus(500);
      expect(r500.retryable).toBe(true);
      expect(r500.category).toBe('network_error');

      const r503 = classifyHttpStatus(503);
      expect(r503.retryable).toBe(true);
      expect(r503.category).toBe('network_error');
    });

    it('classifies 401, 403, and 400 as non-retryable permanent errors', () => {
      const r401 = classifyHttpStatus(401);
      expect(r401.retryable).toBe(false);
      expect(r401.category).toBe('auth_error');

      const r403 = classifyHttpStatus(403);
      expect(r403.retryable).toBe(false);
      expect(r403.category).toBe('auth_error');

      const r400 = classifyHttpStatus(400);
      expect(r400.retryable).toBe(false);
      expect(r400.category).toBe('invalid_payload');
    });
  });

  describe('Circuit Breaker Auto-Recovery Probe', () => {
    it('transitions open circuits to half_open when reset window expires', async () => {
      const db = {
        query: vi.fn().mockResolvedValue({
          rowCount: 2,
          rows: [{ connector_id: 'conn-1' }, { connector_id: 'conn-2' }],
        }),
      } as unknown as Pool;

      const guards = new ConnectorGlobalGuards(db);
      const recovered = await guards.probeOpenCircuits(60);

      expect(recovered).toBe(2);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("state = 'half_open'"),
        [60],
      );
    });

    it('returns 0 cleanly when query fails or no circuits require recovery', async () => {
      const db = {
        query: vi.fn().mockRejectedValue(new Error('DB failure')),
      } as unknown as Pool;

      const guards = new ConnectorGlobalGuards(db);
      const recovered = await guards.probeOpenCircuits(60);

      expect(recovered).toBe(0);
    });
  });
});
