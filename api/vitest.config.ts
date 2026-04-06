import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 10000,
    fileParallelism: false, // Run test files sequentially (shared DB)
    env: {
      DATABASE_URL: 'postgresql://moou:moou@localhost:5432/moou_test',
      TEST_DATABASE_URL: 'postgresql://moou:moou@localhost:5432/moou_test',
      EXTERNAL_PROVIDER: 'valueedge',
    },
  },
});
