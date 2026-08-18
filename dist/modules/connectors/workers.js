import './registry.js'; // ensure built-in connector types register
import { registerConnectorWorkers } from './queue.js';
export async function startConnectorMonitor(logger, config = {}) {
    return registerConnectorWorkers(logger, undefined, config);
}
//# sourceMappingURL=workers.js.map