import { app } from './app.js';
import { seed } from './db/seed.js';
import { reconcileConfiguredAdmins } from './auth/configured-admins.js';
import { pool } from './db/index.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import cron from 'node-cron';
import { recalculateAll } from './scoring/recalculate.js';

// Patch console to prepend ISO timestamps on every log line.
for (const level of ['log', 'error', 'warn', 'info'] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => orig(`[${new Date().toISOString()}]`, ...args);
}

const port = Number(process.env.PORT) || 3000;

const SUPPORTED_PROVIDERS = ['github', 'valueedge'];
if (!SUPPORTED_PROVIDERS.includes(process.env.EXTERNAL_PROVIDER || '')) {
  console.error(
    `Fatal: EXTERNAL_PROVIDER must be set to one of: ${SUPPORTED_PROVIDERS.join(', ')}.\n` +
    `Got: ${JSON.stringify(process.env.EXTERNAL_PROVIDER)}`,
  );
  process.exit(1);
}

async function start() {
  // Run migrations before anything else
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = join(__dirname, '../drizzle');
  const migrationDb = drizzle(pool);
  console.log('Running database migrations...');
  await migrate(migrationDb, { migrationsFolder });
  console.log('Migrations complete.');

  try {
    await seed();
  } catch (err) {
    console.error('Seed error:', err);
  }

  // Bootstrap configured admins (after seed, before listen)
  await reconcileConfiguredAdmins();

  cron.schedule('0 0 * * *', () => {
    console.log('Running daily score recalculation...');
    recalculateAll().catch(err => console.error('Recalculation error:', err));
  });

  const server = app.listen(port, () => {
    console.log(`moou api listening on :${port}`);
  });

  function shutdown(signal: string) {
    console.log(`${signal} received. Shutting down...`);
    server.close(async () => {
      await pool.end();
      console.log('Server and DB pool closed.');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
