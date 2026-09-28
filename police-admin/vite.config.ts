import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_URL || 'http://localhost:3000';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/communications/' : '/',
  server: {
    port: 5174,
    host: true,
    open: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    port: 5174,
    host: true,
  },
}));
