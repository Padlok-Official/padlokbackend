import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import db from '../config/database';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATIONS_TABLE = 'schema_migrations';

async function ensureMigrationsTable(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function getExecutedMigrations(): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY id`
  );
  return rows.map((r) => r.name);
}

async function runMigrations(): Promise<void> {
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
    await ensureMigrationsTable();
    const executed = await getExecutedMigrations();
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const name = file.replace('.sql', '');
      if (executed.includes(name)) {
        console.log(`[SKIP] ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`,
        [name]
      );
      await client.query('COMMIT');
      console.log(`[OK] ${file}`);
    }
    console.log('Migrations complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', (err as Error).message);
    process.exit(1);
  } finally {
    client.release();
    await db.disconnect();
  }
}

runMigrations();
