import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: { port: 5176, proxy: { '/admin-api': 'http://localhost:4100', '/api': 'http://localhost:4100' } },
  build: { outDir: 'dist' },
});
