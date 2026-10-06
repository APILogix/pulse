import '../../config/dns.js';
import { type Pool } from 'pg';
import { logDB } from '../../config/log-database.js';
import { registerAlertingWorkers } from '../../modules/alerting/queue.js';
import { startConnectorMonitor } from '../../modules/connectors/workers.js';
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
export declare class AlertWorkerProcess {
    private readonly primaryPool;
    private readonly logDatabase;
    private readonly registerConnectors;
    private readonly registerAlerting;
    private readonly assertRuntimePool;
    private readonly assertConfigPool;
    private readonly exit;
    private readonly installSignals;
    private readonly hasCustomPool;
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