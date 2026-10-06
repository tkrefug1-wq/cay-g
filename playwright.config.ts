import 'dotenv/config';
import { defineConfig } from '@playwright/test';
const database = process.env.TEST_DATABASE_URL;
if (!database || database === process.env.DATABASE_URL || !new URL(database).pathname.endsWith('_test')) throw new Error('Use a separate *_test database for E2E');
export default defineConfig({
  globalSetup: './tests/e2e/setup.ts',
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 60_000,
  use: { baseURL: 'http://localhost:3001', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run start -- -p 3001', url: 'http://localhost:3001/login', reuseExistingServer: false, timeout: 60_000, env: { DATABASE_URL: database, APP_ORIGIN: 'http://localhost:3001' } },
});
