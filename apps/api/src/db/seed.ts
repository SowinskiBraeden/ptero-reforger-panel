import { eq } from 'drizzle-orm';
import { createDb, schema } from './client.js';

// Seeds only the server row. Everything else (configuration, players,
// sessions, events, activity) comes from the real server: config revisions are
// imported from config.json and player data from log ingestion. No fake data.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);

const existing = await db
  .select()
  .from(schema.servers)
  .where(eq(schema.servers.slug, 'training-server'));

const pterodactylServerId = process.env.PTERODACTYL_SERVER_ID || null;

if (existing[0]) {
  if (pterodactylServerId && existing[0].pterodactylServerId !== pterodactylServerId) {
    await db
      .update(schema.servers)
      .set({ pterodactylServerId })
      .where(eq(schema.servers.id, existing[0].id));
    console.log(`Updated pterodactylServerId to ${pterodactylServerId}.`);
  } else {
    console.log('Server "training-server" already exists; nothing to do.');
  }
} else {
  await db.insert(schema.servers).values({
    slug: 'training-server',
    // Placeholder until the first config.json import overwrites it.
    name: 'Reforger Server',
    providerType: 'pterodactyl',
    pterodactylServerId,
    status: 'unknown',
    maxPlayers: null,
  });
  console.log('Seeded server row (name/maxPlayers will be imported from config.json).');
}

await pool.end();
console.log('Seed complete.');
