import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local encrypted-report authorization is NOT a LAN or hosted web service.
// Keep the dev browser and its proxy bound to loopback only.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api/proof': { target: 'http://127.0.0.1:4175', changeOrigin: false },
      '/api/lot': { target: 'http://127.0.0.1:4174', changeOrigin: false },
    },
  },
  preview: { host: '127.0.0.1' },
});
