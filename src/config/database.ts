import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

class Database {
  private pool: Pool | null = null;

  async connect(): Promise<void> {
    const connectionString = process.env.DATABASE_URL;

    let config: PoolConfig | string;

    if (connectionString) {
      console.log('📦 Using connection URL');
      const isSupabase = connectionString.includes('supabase.co');
      const isRailway =
        connectionString.includes('railway.app') ||
        connectionString.includes('railway.internal');

      config = {
        connectionString,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        ...((isSupabase || isRailway) && {
          ssl: { rejectUnauthorized: false },
        }),
      };
    } else if (process.env.DB_HOST) {
      console.log('📦 Using individual parameters (host, user, database)');
      const useSsl = process.env.DB_SSL !== 'false';
      config = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'postgres',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        ...(useSsl && {
          ssl: {
            rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true',
          },
        }),
      };
    } else {
      console.error('❌ No database configuration found!');
      console.error(
        '💡 Please set either DATABASE_URL or DB_HOST, DB_NAME, DB_USER, DB_PASSWORD'
      );
      throw new Error('Database configuration missing');
    }


    this.pool = new Pool(config);

    this.pool.on('error', (err: Error) => {
      console.error('Unexpected database pool error:', err);
    });

    try {
      await this.pool.query('SELECT NOW()');
      console.log('✅ Database pool created successfully');
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      console.error('❌ Error connecting to database:', error.message);

      if (error.code === 'ENOTFOUND') {
        console.error('💡 DNS resolution failed. Check hostname and network.');
      } else if (error.code === 'ETIMEDOUT') {
        console.error('💡 Connection timeout. Check firewall and network.');
      } else if (error.code === 'ECONNREFUSED') {
        console.error('💡 Connection refused. Verify host, port, and that DB is running.');
      } else if (error.code === '28P01') {
        console.error('💡 Authentication failed. Check username and password.');
      }

      throw err;
    }
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: (string | number | boolean | null | Date)[]
  ): Promise<QueryResult<T>> {
    if (!this.pool) {
      throw new Error('Database pool not initialized. Call connect() first.');
    }
    return this.pool.query<T>(text, params);
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      console.log('Database pool closed');
    }
  }

  getPool(): Pool | null {
    return this.pool;
  }
}

const db = new Database();

export default db;
