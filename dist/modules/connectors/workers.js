import './registry.js'; // ensure built-in connector types register
import { registerConnectorWorkers } from './queue.js';
export async function startConnectorMonitor(logger, config = {}, primaryPool) {
    return registerConnectorWorkers(logger, undefined, config, primaryPool);
}
//# sourceMappingURL=workers.js.map