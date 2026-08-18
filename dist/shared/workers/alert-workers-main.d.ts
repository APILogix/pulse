import { Pool } from 'pg';
import { logDB } from '../../config/log-database.js';
import { startPgBoss, stopPgBoss } from '../../lib/pgboss.js';
import { registerAlertingWorkers } from '../../modules/alerting/queue.js';
import { startConnectorMonitor } from '../../modules/connectors/workers.js';
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
export declare class AlertWorkerProcess {
    private readonly primaryPool;
    private readonly logDatabase;
    private readonly startQueue;
    private readonly stopQueue;
    private readonly registerConnectors;
    private readonly registerAlerting;
    private readonly assertRuntimePool;
    private readonly assertConfigPool;
    private readonly exit;
    private readonly installSignals;
    private connectorWorkers;
    private alertingWorkers;
    private shuttingDown;
    private signalHandlersInstalled;
    constructor(dependencies?: AlertWorkerProcessDependencies);
    start(): Promise<void>;
    installSignalHandlers(): void;
    shutdown(signal: string, code?: number): Promise<void>;
}
//# sourceMappingURL=alert-workers-main.d.ts.map