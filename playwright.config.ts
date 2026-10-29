import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', timeout: 60000, workers: 1, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5187', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:5187', reuseExistingServer: false, timeout: 30000 },
  reporter: 'list',
});
