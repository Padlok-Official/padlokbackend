import { PoolClient } from 'pg';
import db from '../config/database';

/**
 * Wraps a function in a DB transaction.
 * Commits on success, rolls back on error, and always releases the client.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.getPool()!.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
