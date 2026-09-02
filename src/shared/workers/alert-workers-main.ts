import { Pool } from 'pg';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { logDB } from '../../config/log-database.js';
import { isExpectedServerlessDisconnect, resolvePostgresSslConfig } from '../../config/postgres-ssl.js';
import { startPgBoss, stopPgBoss } from '../../lib/pgboss.js';
import { AlertRuntimeRepository } from '../../modules/alerting/runtime/alert-runtime.repository.js';
import { AlertConfigRepository } from '../../modules/alerting/config/alert-config.repository.js';
import { registerAlertingWorkers } from '../../modules/alerting/queue.js';
import { startConnectorMonitor } from '../../modules/connectors/workers.js';

const log = logger.child({ component: 'alert-workers' });

export interface AlertWorkerProcessDependencies {
  primaryPool?: Pool;
  logDatabase?: typeof logDB;
  startQueue?: typeof startPgBoss;
  stopQueue?: typeof stopPgBoss;
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
  private readonly startQueue: typeof startPgBoss;
  private readonly stopQueue: typeof stopPgBoss;
  private readonly registerConnectors: typeof startConnectorMonitor;
  private readonly registerAlerting: typeof registerAlertingWorkers;
  private readonly assertRuntimePool: () => Promise<void>;
  private readonly assertConfigPool: () => Promise<void>;
  private readonly exit: (code: number) => never;
  private readonly installSignals: boolean;
  private connectorWorkers: { stop: () => Promise<void> } | null = null;
  private alertingWorkers: { stop: () => Promise<void> } | null = null;
  private shuttingDown = false;
  private signalHandlersInstalled = false;

  constructor(dependencies: AlertWorkerProcessDependencies = {}) {
    this.primaryPool = dependencies.primaryPool ?? createPrimaryPool();
    this.logDatabase = dependencies.logDatabase ?? logDB;
    this.startQueue = dependencies.startQueue ?? startPgBoss;
    this.stopQueue = dependencies.stopQueue ?? stopPgBoss;
    this.registerConnectors = dependencies.registerConnectors ?? startConnectorMonitor;
    this.registerAlerting = dependencies.registerAlerting ?? registerAlertingWorkers;
    this.assertRuntimePool = dependencies.assertRuntimePool
      ?? (async () => {
        await new AlertRuntimeRepository(this.logDatabase.getPrimaryPool()).assertRuntimePool(log);
      });
    this.assertConfigPool = dependencies.assertConfigPool
      ?? (async () => {
        await new AlertConfigRepository().assertConfigPool(log);
      });
    this.exit = dependencies.exit ?? ((code) => process.exit(code));
    this.installSignals = dependencies.installSignalHandlers ?? true;
  }

  async start(): Promise<void> {
    try {
      await this.primaryPool.query('SELECT 1');
      await this.logDatabase.connect();
      await this.assertRuntimePool();
      await this.assertConfigPool();
      await this.startQueue();

      this.connectorWorkers = await this.registerConnectors(log, {
        group: 'alert-delivery',
        strictQueueCreation: true,
      });
      this.alertingWorkers = await this.registerAlerting(
        log,
        {
          group: 'alert-delivery',
          strictQueueCreation: true,
        },
        undefined,
        this.logDatabase.getPrimaryPool(),
      );

      if (this.installSignals) this.installSignalHandlers();
      process.send?.('ready');
      log.info(
        {
          alertQueues: 'evaluation, routing, escalation',
          connectorQueues: 'v2 transport, legacy transport, delivery retry',
        },
        '[alert-workers] Alert worker group ready',
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
    try {
      if (this.connectorWorkers) await this.connectorWorkers.stop();
      if (this.alertingWorkers) await this.alertingWorkers.stop();
      await this.stopQueue();
      await this.logDatabase.close();
      await this.primaryPool.end();
    } catch (error) {
      log.error({ error }, '[alert-workers] Error during shutdown');
      code = code || 1;
    } finally {
      log.info('[alert-workers] Alert worker group stopped');
      this.exit(code);
    }
  }
}

function createPrimaryPool(): Pool {
  const primaryPool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: resolvePostgresSslConfig(env.DATABASE_URL, {
      enabled: env.DB_SSL_ENABLED,
      rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
    }),
    max: env.DB_POOL_MAX,
    min: env.DB_POOL_MIN,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
    application_name: `pulse_alert_workers_${env.NODE_ENV}`,
    keepAlive: true,
    keepAliveInitialDelayMillis: env.DB_KEEPALIVE_INITIAL_DELAY_MS,
  });
  primaryPool.on('connect', (client) => {
    client.on('error', (error: Error) => {
      if (isExpectedServerlessDisconnect(error)) {
        log.debug({ error: error.message }, '[alert-workers] Client primary pool connection closed');
        return;
      }
      log.debug({ error: error.message }, '[alert-workers] PostgreSQL client socket error on active/checked-out connection');
    });
  });
  primaryPool.on('error', (error: Error) => {
    if (isExpectedServerlessDisconnect(error)) {
      log.debug({ error: error.message }, '[alert-workers] Idle primary pool connection closed');
      return;
    }
    log.error({ error }, '[alert-workers] Primary pool error');
  });
  return primaryPool;
}

const entryPoint = process.argv[1] ?? '';
if (/[\\/]alert-workers-main\.(ts|js)$/.test(entryPoint)) {
  void new AlertWorkerProcess().start();
}
