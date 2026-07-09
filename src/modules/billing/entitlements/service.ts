import { EntitlementsRepository } from './repository.js';

export class EntitlementsService {
  constructor(private readonly repository: EntitlementsRepository) {}

  async getAllEntitlements(orgId: string) {
    const entitlements = await this.repository.getEffectiveEntitlements(orgId);
    
    // Transform array to a map for easier frontend consumption
    const map = entitlements.reduce((acc, curr) => {
      acc[curr.feature_key] = {
        booleanValue: curr.boolean_value,
        integerValue: curr.integer_value,
        decimalValue: curr.decimal_value,
        stringValue: curr.string_value
      };
      return acc;
    }, {} as Record<string, any>);

    return { success: true, data: map };
  }

  async checkFeatureAccess(orgId: string, featureKey: string, quantity: number = 1) {
    // Check if it's a boolean feature
    const hasFeature = await this.repository.hasFeature(orgId, featureKey);
    if (!hasFeature) {
      // It might be an integer feature, fallback to checking if it's an integer
      // In a real application, you might want a robust feature cache.
      const limit = await this.repository.getEffectiveIntegerFeature(orgId, featureKey);
      
      // If the limit is 0 and boolean is false, it means no access.
      if (limit === 0 && quantity > 0) {
        return { success: true, data: { granted: false, reason: 'feature_not_included_or_limit_exceeded' } };
      }
      
      // Checking usage against limit should normally go through the UsageService for current counters.
      // Since this service doesn't have the usage counter, we just return if the limit is sufficient statically,
      // But actually, quota validation is dynamic (limit - used >= quantity).
      // We will delegate dynamic quota validation to the Usage slice or a Facade.
      // This method here just says "does the org have this feature enabled?".
      
      return { success: true, data: { granted: limit > 0, limit } };
    }

    return { success: true, data: { granted: true } };
  }
}
