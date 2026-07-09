import { pool } from '../../../config/database.js';
export class EntitlementsRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async getEffectiveEntitlements(orgId, db = this.db) {
        const result = await db.query(`SELECT organization_id, feature_key, boolean_value, integer_value, decimal_value, string_value
       FROM v_effective_entitlements
       WHERE organization_id = $1`, [orgId]);
        return result.rows;
    }
    async hasFeature(orgId, featureKey, db = this.db) {
        const result = await db.query(`SELECT has_feature($1, $2) as has_access`, [orgId, featureKey]);
        return result.rows[0]?.has_access === true;
    }
    async getEffectiveIntegerFeature(orgId, featureKey, db = this.db) {
        const result = await db.query(`SELECT get_effective_integer_feature($1, $2) as limit_val`, [orgId, featureKey]);
        return parseInt(result.rows[0]?.limit_val ?? '0', 10);
    }
}
//# sourceMappingURL=repository.js.map