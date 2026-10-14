import { CreditWeightService, DEFAULT_CREDIT_WEIGHTS, creditWeightService, getCreditWeightService, } from '../../billing/usage/credit-weight.service.js';
export { CreditWeightService, DEFAULT_CREDIT_WEIGHTS, creditWeightService, getCreditWeightService, };
/**
 * Backwards compatibility alias for components initialized with CreditWeightResolver.
 */
export class CreditWeightResolver extends CreditWeightService {
    /**
     * Synchronous accessor for credit weight multiplier matching the original Resolver helper.
     */
    getWeightResolver(eventType) {
        return this.getWeightSync(eventType);
    }
}
//# sourceMappingURL=credit-weights.js.map