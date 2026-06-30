import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './dispatcher.js';
import { ConnectorService } from './service.js';
import { ConnectorMonitor } from './monitor.js';
import './registry.js'; // ensure built-in connector types register
export function startConnectorMonitor(logger) {
    const log = logger.child({ component: 'connector-monitor-worker' });
    const repository = new ConnectorRepository();
    const dispatcher = new NotificationDispatcher(repository, logger);
    const service = new ConnectorService({
        repository,
        dispatcher,
        logger,
        emitEvent: async () => undefined,
    });
    const monitor = new ConnectorMonitor(repository, dispatcher, service, logger);
    monitor.start();
    log.info('Connector monitor started');
    return {
        stop: async () => {
            monitor.stop();
        },
    };
}
//# sourceMappingURL=workers.js.map