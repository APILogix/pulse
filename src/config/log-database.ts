import { Pool, type PoolClient, type QueryResult } from 'pg';
import { env } from './env.js';
import { logger } from './logger.js';

class LogDatabaseManager {
  private primaryPool: Pool;
  private isShuttingDown = false;

  constructor() {
    // Single pool for development (will split later for replica)
    this.primaryPool = new Pool({
      connectionString: env.LOG_DB_PRIMARY,
      max: parseInt(env.LOG_POOL_MAX || '20'),
      min: parseInt(env.LOG_POOL_MIN || '5'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
      query_timeout: 30000,
      application_name: 'log_ingestion_dev',
      ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
    });

    this.setupPoolMonitoring(this.primaryPool);
  }

  /**
   * Test connection on startup (FAIL FAST)
   */
  async connect(): Promise<{ primary: Date }> {
    logger.info('Testing log database connection...');
    
    try {
      const client = await this.primaryPool.connect();
      const res = await client.query('SELECT NOW() as time, current_database() as db');
      const primaryTime = res.rows[0].time;
      
      logger.info({
        db: res.rows[0].db,
        time: primaryTime,
      }, '✅ Log DB connected');
      
      client.release();
      return { primary: primaryTime };
    } catch (err) {
      logger.error({ err }, '❌ Failed to connect to Log DB');
      process.exit(1);
    }
  }

  private setupPoolMonitoring(pool: Pool) {
    pool.on('connect', () => {
      logger.debug('New DB connection established');
    });

    pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected pool error');
    });
  }

  /**
   * Get connection (simplified - always returns primary)
   * When you add replica later, add 'operation' param here
   */
  async getConnection(options?: { projectId?: string }): Promise<PoolClient> {
    const client = await this.primaryPool.connect();
    
    if (options?.projectId) {
      await client.query('SET app.current_project_id = $1', [options.projectId]);
    }
    
    return client;
  }

  /**
   * Execute with retry logic
   */
  async queryWithRetry<T = any>(
    sql: string,
    params?: any[],
    options: {
      maxRetries?: number;
      projectId?: string;
      timeout?: number;
    } = {}
  ): Promise<QueryResult<T>> {
    const { maxRetries = 3, projectId, timeout } = options;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const client = await this.getConnection({ projectId });
      
      try {
        if (timeout) {
          await client.query(`SET statement_timeout = ${timeout}`);
        }

        const start = Date.now();
        const result = await client.query<T>(sql, params);
        const duration = Date.now() - start;

        if (duration > 1000) {
          logger.warn({ query: sql.slice(0, 100), duration }, 'Slow query detected');
        }

        return result;
      } catch (err: any) {
        lastError = err;
        
        // Don't retry on constraint violations or syntax errors
        if (err.code === '23505' || err.code === '42501' || err.code === '42601') {
          throw err;
        }

        if (attempt < maxRetries - 1) {
          const delay = Math.min(1000 * (2 ** attempt), 5000);
          logger.warn({ error: err.message, attempt: attempt + 1 }, 'Query failed, retrying...');
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } finally {
        client.release();
      }
    }

    throw lastError || new Error('Query failed after retries');
  }

  /**
   * Batch insert (simplified without COPY protocol)
   */
  async batchInsertEvents(events: Array<{
    project_id: string;
    type: string;
    timestamp: Date;
    payload: object;
  }>): Promise<void> {
    if (events.length === 0) return;

    const client = await this.getConnection();
    
    try {
      // Use regular multi-row insert (good for < 1000 rows)
      const values = events.map((_, i) => 
        `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`
      ).join(',');

      const params = events.flatMap(e => [
        e.project_id,
        e.type,
        e.timestamp,
        JSON.stringify(e.payload)
      ]);

      await client.query(`
        INSERT INTO events (project_id, type, timestamp, payload)
        VALUES ${values}
      `, params);

      // Insert into specialized tables if needed
      const requests = events.filter(e => e.type === 'request');
      const errors = events.filter(e => e.type === 'error');

      if (requests.length > 0) {
        await this.insertRequests(client, requests);
      }
      if (errors.length > 0) {
        await this.insertErrors(client, errors);
      }

    } finally {
      client.release();
    }
  }

  private async insertRequests(client: PoolClient, requests: any[]) {
    const values = requests.map((r, i) => 
      `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`
    ).join(',');
    
    const params = requests.flatMap(r => [
      r.project_id, 
      r.payload.request_id, 
      r.payload.url, 
      r.payload.method, 
      r.payload.status_code, 
      r.timestamp
    ]);

    await client.query(`
      INSERT INTO request_events (project_id, request_id, url, method, status_code, timestamp)
      VALUES ${values}
    `, params);
  }

  private async insertErrors(client: PoolClient, errors: any[]) {
    const crypto = await import('crypto');
    
    for (const error of errors) {
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${error.payload.error_type}:${JSON.stringify(error.payload.stack)}`)
        .digest('hex')
        .slice(0, 16);

      await client.query(`
        INSERT INTO error_events (project_id, request_id, message, error_type, fingerprint, stack, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        error.project_id,
        error.payload.request_id,
        error.payload.message,
        error.payload.error_type,
        fingerprint,
        JSON.stringify(error.payload.stack),
        error.timestamp
      ]);
    }
  }

  /**
   * Simple health check
   */
  async healthCheck(): Promise<{ healthy: boolean; timestamp?: Date }> {
    try {
      const res = await this.primaryPool.query('SELECT NOW() as time');
      return { healthy: true, timestamp: res.rows[0].time };
    } catch (e) {
      logger.error('Health check failed');
      return { healthy: false };
    }
  }

  async close() {
    this.isShuttingDown = true;
    logger.info('Closing log database pool...');
    await this.primaryPool.end();
  }
}

// Export singleton
export const logDB = new LogDatabaseManager();

// Convenience helpers
export const logQuery = <T = any>(
  sql: string, 
  params?: any[], 
  options?: Parameters<typeof logDB['queryWithRetry']>[2]
) => logDB.queryWithRetry<T>(sql, params, options);

export const connectLogDB = async () => {
  return logDB.connect();
};