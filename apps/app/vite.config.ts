import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const releaseProxy = {
  target: 'https://github.com',
  changeOrigin: true,
  followRedirects: true,
  rewrite: (path: string) =>
    path.replace(/^\/content\/releases\//u, '/T-Damer/MiniMed/releases/download/'),
};

export default defineConfig({
  base: './',
  plugins: [solid()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/content/releases': releaseProxy,
    },
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  preview: {
    host: '127.0.0.1',
    proxy: {
      '/content/releases': releaseProxy,
    },
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
});
