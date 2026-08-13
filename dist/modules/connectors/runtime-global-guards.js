export class ConnectorGlobalGuards {
    db;
    constructor(db) {
        this.db = db;
    }
    async acquire(connectorId, config) {
        try {
            const result = await this.db.query(`WITH circuit AS (
           SELECT CASE
             WHEN state = 'open' AND opened_at <= NOW() - ($2::int * INTERVAL '1 second') THEN 'half_open'
             ELSE state
           END AS state
             FROM connector_circuit_state
            WHERE connector_id = $1
         ), bucket AS (
           INSERT INTO connector_rate_buckets (connector_id, window_start, window_seconds, consumed)
           VALUES ($1, date_trunc('second', NOW()), $3, 1)
           ON CONFLICT (connector_id) DO UPDATE SET
             window_start = CASE
               WHEN connector_rate_buckets.window_start <= NOW() - (connector_rate_buckets.window_seconds * INTERVAL '1 second')
               THEN date_trunc('second', NOW()) ELSE connector_rate_buckets.window_start END,
             window_seconds = EXCLUDED.window_seconds,
             consumed = CASE
               WHEN connector_rate_buckets.window_start <= NOW() - (connector_rate_buckets.window_seconds * INTERVAL '1 second')
               THEN 1 ELSE connector_rate_buckets.consumed + 1 END,
             updated_at = NOW()
           RETURNING consumed
         )
         SELECT bucket.consumed <= $4 AS allowed,
                COALESCE(circuit.state, 'closed') AS circuit_state,
                bucket.consumed
           FROM bucket
           LEFT JOIN circuit ON TRUE`, [connectorId, config.resetSeconds, config.windowSeconds, config.limit]);
            const row = result.rows[0];
            if (!row)
                return { allowed: true, circuitState: 'closed', remainingTokens: config.limit, usedFallback: true };
            return {
                allowed: row.allowed && row.circuit_state !== 'open',
                circuitState: row.circuit_state,
                remainingTokens: Math.max(0, config.limit - Number(row.consumed)),
                usedFallback: false,
            };
        }
        catch {
            return { allowed: true, circuitState: 'closed', remainingTokens: config.limit, usedFallback: true };
        }
    }
    async recordSuccess(connectorId) {
        await this.db.query(`INSERT INTO connector_circuit_state
         (connector_id, state, consecutive_failures, last_success_at, updated_at)
       VALUES ($1, 'closed', 0, NOW(), NOW())
       ON CONFLICT (connector_id) DO UPDATE SET
         state = 'closed', consecutive_failures = 0, half_open_at = NULL,
         last_success_at = NOW(), updated_at = NOW()`, [connectorId]);
    }
    async recordFailure(connectorId, failureThreshold) {
        await this.db.query(`INSERT INTO connector_circuit_state
         (connector_id, state, consecutive_failures, opened_at, last_failure_at, updated_at)
       VALUES ($1, CASE WHEN $2 >= $3 THEN 'open' ELSE 'closed' END, 1,
               CASE WHEN $2 >= $3 THEN NOW() ELSE NULL END, NOW(), NOW())
       ON CONFLICT (connector_id) DO UPDATE SET
         consecutive_failures = connector_circuit_state.consecutive_failures + 1,
         state = CASE WHEN connector_circuit_state.consecutive_failures + 1 >= $3 THEN 'open' ELSE connector_circuit_state.state END,
         opened_at = CASE WHEN connector_circuit_state.consecutive_failures + 1 >= $3 THEN NOW() ELSE connector_circuit_state.opened_at END,
         last_failure_at = NOW(), updated_at = NOW()`, [connectorId, 1, failureThreshold]);
    }
    /**
     * Periodically check open circuits whose reset window has passed and transition
     * them to 'half_open' so idle connectors can recover without waiting for new traffic.
     */
    async probeOpenCircuits(resetSeconds) {
        try {
            const result = await this.db.query(`UPDATE connector_circuit_state
            SET state = 'half_open',
                half_open_at = NOW(),
                updated_at = NOW()
          WHERE state = 'open'
            AND opened_at <= NOW() - ($1::int * INTERVAL '1 second')
          RETURNING connector_id`, [resetSeconds]);
            return result.rowCount ?? 0;
        }
        catch {
            return 0;
        }
    }
}
//# sourceMappingURL=runtime-global-guards.js.map