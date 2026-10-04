import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  optimizeDeps: { include: ['@localfinance/shared'] },
  build: { commonjsOptions: { include: [/shared/, /node_modules/] } },
});
