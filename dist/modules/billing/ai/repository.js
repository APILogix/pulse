import { pool } from '../../../config/database.js';
export class AiBillingRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async withTransaction(callback) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async logAiUsage(record, db = this.db) {
        await db.query(`INSERT INTO ai_usage_logs (
         organization_id, project_id, user_id, feature_key, provider, model, 
         credits_used, prompt_tokens, completion_tokens, estimated_cost_usd
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
            record.organization_id,
            record.project_id ?? null,
            record.user_id ?? null,
            record.feature_key,
            record.provider,
            record.model,
            record.credits_used,
            record.prompt_tokens,
            record.completion_tokens,
            record.estimated_cost_usd
        ]);
    }
    async consumeAiCredits(orgId, credits, db = this.db) {
        await db.query(`SELECT consume_ai_credits($1, $2)`, [orgId, credits]);
    }
    async hasSufficientAiCredits(orgId, requiredCredits, db = this.db) {
        const result = await db.query(`SELECT remaining_ai_credits($1) >= $2 as has_credits`, [orgId, requiredCredits]);
        return result.rows[0]?.has_credits === true;
    }
}
//# sourceMappingURL=repository.js.map