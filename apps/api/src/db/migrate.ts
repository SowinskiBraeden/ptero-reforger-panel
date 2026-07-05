import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { createDb } from './client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

// Run from apps/api (the npm scripts do this); migrations live in ./drizzle.
const migrationsFolder = path.resolve(process.cwd(), 'drizzle');

const { db, pool } = createDb(databaseUrl);
await migrate(db, { migrationsFolder });
await pool.end();
console.log('Migrations applied.');
