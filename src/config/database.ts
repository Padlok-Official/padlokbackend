import logger from '../utils/logger';
import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

class Database {
  private pool: Pool | null = null;

  private ensurePool(): Pool {
    if (this.pool) return this.pool;

    const connectionString = process.env.DATABASE_URL;

    let config: PoolConfig;

    if (connectionString) {
      const isSupabase = connectionString.includes('supabase.co');
      const isRailway =
        connectionString.includes('railway.app') ||
        connectionString.includes('railway.internal');

      config = {
        connectionString,
        max: parseInt(process.env.DB_POOL_MAX || '40', 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000,
        statement_timeout: 30000,
        ...((isSupabase || isRailway) && {
          ssl: { rejectUnauthorized: false },
        }),
      };
    } else if (process.env.DB_HOST) {
      const useSsl = process.env.DB_SSL !== 'false';
      config = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'postgres',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        max: parseInt(process.env.DB_POOL_MAX || '40', 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000,
        statement_timeout: 30000,
        ...(useSsl && {
          ssl: {
            rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true',
          },
        }),
      };
    } else {
      throw new Error(
        'Database configuration missing. Set either DATABASE_URL or DB_HOST, DB_NAME, DB_USER, DB_PASSWORD'
      );
    }

    this.pool = new Pool(config);

    this.pool.on('error', (err: Error) => {
      logger.error({ data: err }, 'Unexpected database pool error');
    });

    return this.pool;
  }

  async connect(): Promise<void> {
    const pool = this.ensurePool();

    try {
      await pool.query('SELECT NOW()');
      logger.info('Database pool created successfully');
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      logger.error(`Error connecting to database: `);

      if (error.code === 'ENOTFOUND') {
        logger.error('💡 DNS resolution failed. Check hostname and network.');
      } else if (error.code === 'ETIMEDOUT') {
        logger.error('💡 Connection timeout. Check firewall and network.');
      } else if (error.code === 'ECONNREFUSED') {
        logger.error('💡 Connection refused. Verify host, port, and that DB is running.');
      } else if (error.code === '28P01') {
        logger.error('💡 Authentication failed. Check username and password.');
      }

      throw err;
    }
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: (string | number | boolean | null | Date)[]
  ): Promise<QueryResult<T>> {
    return this.ensurePool().query<T>(text, params);
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('Database pool closed');
    }
  }

  getPool(): Pool {
    return this.ensurePool();
  }
}

const db = new Database();

export default db;
