import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  root: 'apps/desktop', base: './', plugins: [react(), tailwind()],
  server: { host: '127.0.0.1', port: 5187, strictPort: true },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
});
