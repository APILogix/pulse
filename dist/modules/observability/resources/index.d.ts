/**
 * Explorer resource registry. Registering a resource here is all it takes to
 * expose a fully-featured explorer (list/summary/statistics/timeline/detail)
 * through the Unified Explorer Query Engine.
 */
import { ResourceRegistry } from '../query-engine/field-registry.js';
import { requestsResource } from './requests.resource.js';
import { errorsResource } from './errors.resource.js';
import { logsResource } from './logs.resource.js';
import { tracesResource } from './traces.resource.js';
import { spansResource } from './spans.resource.js';
import { metricsResource } from './metrics.resource.js';
import { cronsResource } from './crons.resource.js';
import { profilesResource } from './profiles.resource.js';
import { errorGroupsResource } from './error-groups.resource.js';
export declare const explorerRegistry: ResourceRegistry;
export { requestsResource, errorsResource, logsResource, tracesResource, spansResource, metricsResource, cronsResource, profilesResource, errorGroupsResource, };
//# sourceMappingURL=index.d.ts.map