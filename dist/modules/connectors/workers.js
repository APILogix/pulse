import './registry.js'; // ensure built-in connector types register
import { registerConnectorWorkers } from './queue.js';
export async function startConnectorMonitor(logger) {
    return registerConnectorWorkers(logger);
}
//# sourceMappingURL=workers.js.map