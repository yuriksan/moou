import { app } from './app.js';
import { seed } from './db/seed.js';
import { seedDemo } from './db/seed-demo.js';
import { pool } from './db/index.js';
import cron from 'node-cron';
import { recalculateAll } from './scoring/recalculate.js';

const port = Number(process.env.PORT) || 3000;

async function start() {
  try {
    await seed();
    await seedDemo();
  } catch (err) {
    console.error('Seed error:', err);
  }

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
