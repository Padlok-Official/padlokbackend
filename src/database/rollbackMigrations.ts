import 'dotenv/config';
import db from '../config/database';

const MIGRATIONS_TABLE = 'schema_migrations';

async function rollbackLast(): Promise<void> {
  try {
    await db.connect();
  } catch {
    process.exit(1);
  }

  const pool = db.getPool();
  if (!pool) {
    console.error('Database pool not available');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ name: string }>(
      `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY id DESC LIMIT 1`
    );
    if (rows.length === 0) {
      console.log('No migrations to rollback.');
      return;
    }
    const last = rows[0].name;
    await client.query('BEGIN');
    await client.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE name = $1`, [
      last,
    ]);
    await client.query('COMMIT');
    console.log(`Rolled back: ${last}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Rollback failed:', (err as Error).message);
    process.exit(1);
  } finally {
    client.release();
    await db.disconnect();
  }
}

rollbackLast();
