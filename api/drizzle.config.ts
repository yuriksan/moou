import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: 'src/db/schema.ts',
  out: 'drizzle',
  cwd: import.meta.dirname,
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
