import '../../config/dns.js';
import { type Pool } from 'pg';
import { closeDatabase, pool as canonicalPrimaryPool, notificationPool } from '../../config/database.js';
import { env } from '../../config/env.js';
import { logProcessConnectionBudget } from '../../config/connection-budget.js';
import { logger } from '../../config/logger.js';
import { logDB } from '../../config/log-database.js';
import { retryConfiguredStartupOperation } from '../../config/startup-retry.js';
import { pgmq } from '../../lib/pgmq.js';
import { AlertRuntimeRepository } from '../../modules/alerting/runtime/alert-runtime.repository.js';
import { AlertConfigRepository } from '../../modules/alerting/config/alert-config.repository.js';
import { registerAlertingWorkers } from '../../modules/alerting/queue.js';
import { startConnectorMonitor } from '../../modules/connectors/workers.js';

const log = logger.child({ component: 'alert-workers' });

export interface AlertWorkerProcessDependencies {
  primaryPool?: Pool;
  logDatabase?: typeof logDB;
  registerConnectors?: typeof startConnectorMonitor;
  registerAlerting?: typeof registerAlertingWorkers;
  assertRuntimePool?: () => Promise<void>;
  assertConfigPool?: () => Promise<void>;
  exit?: (code: number) => never;
  installSignalHandlers?: boolean;
}

export class AlertWorkerProcess {
  private readonly primaryPool: Pool;
  private readonly logDatabase: typeof logDB;
  private readonly registerConnectors: typeof startConnectorMonitor;
  private readonly registerAlerting: typeof registerAlertingWorkers;
  private readonly assertRuntimePool: () => Promise<void>;
  private readonly assertConfigPool: () => Promise<void>;
  private readonly exit: (code: number) => never;
  private readonly installSignals: boolean;
  private readonly hasCustomPool: boolean;
  private connectorWorkers: { stop: () => Promise<void> } | null = null;
  private alertingWorkers: { stop: () => Promise<void> } | null = null;
  private shuttingDown = false;
  private signalHandlersInstalled = false;

  constructor(dependencies: AlertWorkerProcessDependencies = {}) {
    this.hasCustomPool = Boolean(dependencies.primaryPool);
    this.primaryPool = dependencies.primaryPool ?? notificationPool ?? canonicalPrimaryPool;
    this.logDatabase = dependencies.logDatabase ?? logDB;
    this.registerConnectors = dependencies.registerConnectors ?? startConnectorMonitor;
    this.registerAlerting = dependencies.registerAlerting ?? registerAlertingWorkers;
    this.assertRuntimePool = dependencies.assertRuntimePool
      ?? (async () => {
        await new AlertRuntimeRepository(this.logDatabase.getPrimaryPool()).assertRuntimePool(log);
      });
    this.assertConfigPool = dependencies.assertConfigPool
      ?? (async () => {
        await new AlertConfigRepository(this.primaryPool).assertConfigPool(log);
      });
    this.exit = dependencies.exit ?? ((code) => process.exit(code));
    this.installSignals = dependencies.installSignalHandlers ?? true;
  }

  async start(): Promise<void> {
    try {
      logProcessConnectionBudget('alert-worker', log);
      await retryConfiguredStartupOperation(
        'alert worker primary database',
        () => this.primaryPool.query('SELECT 1'),
        log,
      );
      await retryConfiguredStartupOperation(
        'alert worker log database',
        () => this.logDatabase.connect(),
        log,
      );
      await this.assertRuntimePool();
      await this.assertConfigPool();

      // Pre-load all existing queue metadata once to eliminate sequential DDL round-trips
      if (!this.hasCustomPool) {
        await pgmq.ensureKnownQueuesLoaded().catch(() => {});
      }

      const [connectors, alerting] = await Promise.all([
        this.registerConnectors(
          log,
          {
            group: 'alert-delivery',
            strictQueueCreation: true,
          },
          this.primaryPool,
        ),
        this.registerAlerting(
          log,
          {
            group: 'alert-delivery',
            strictQueueCreation: true,
          },
          undefined,
          this.logDatabase.getPrimaryPool(),
          this.primaryPool,
        ),
      ]);
      this.connectorWorkers = connectors;
      this.alertingWorkers = alerting;

      if (this.installSignals) this.installSignalHandlers();
      process.send?.('ready');
      log.info(
        {
          alertQueues: 'evaluation, routing, escalation',
          connectorQueues: 'v2 transport, delivery retry',
        },
        '[alert-workers] Alert worker group ready with Supabase PGMQ',
      );
    } catch (error) {
      log.fatal({ error }, '[alert-workers] Failed to start alert worker group');
      await this.shutdown('startup-failure', 1);
    }
  }

  installSignalHandlers(): void {
    if (this.signalHandlersInstalled) return;
    this.signalHandlersInstalled = true;
    process.on('SIGTERM', () => void this.shutdown('SIGTERM'));
    process.on('SIGINT', () => void this.shutdown('SIGINT'));
  }

  async shutdown(signal: string, code = 0): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    log.info({ signal }, '[alert-workers] Shutdown signal received — draining workers');
    const deadline = setTimeout(() => {
      log.fatal({ signal }, '[alert-workers] Shutdown deadline exceeded');
      this.exit(code || 1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    deadline.unref();

    try {
      const stopResults = await Promise.allSettled([
        this.connectorWorkers?.stop(),
        this.alertingWorkers?.stop(),
      ].filter((operation): operation is Promise<void> => operation !== undefined));
      const closeResults = await Promise.allSettled([
        ...(!this.hasCustomPool ? [pgmq.close()] : []),
        this.logDatabase.close(),
        this.hasCustomPool ? this.primaryPool.end() : closeDatabase(),
      ]);
      if ([...stopResults, ...closeResults].some((result) => result.status === 'rejected')) {
        code = code || 1;
      }
    } catch (error) {
      log.error({ error }, '[alert-workers] Error during shutdown');
      code = code || 1;
    } finally {
      clearTimeout(deadline);
      log.info('[alert-workers] Alert worker group stopped');
      this.exit(code);
    }
  }
}

const entryPoint = process.argv[1] ?? '';
if (/[\\/]alert-workers-main\.(ts|js)$/.test(entryPoint)) {
  void new AlertWorkerProcess().start();
}
