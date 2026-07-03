import { defineConfig } from 'vite';
import react            from '@vitejs/plugin-react';
import path             from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // Clean absolute imports: import { X } from '@/components/...'
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    port: 5173,
    // Proxy all /api requests to the local API service during development.
    // In production, the API URL is set via VITE_API_BASE_URL.
    proxy: {
      '/api': {
        target:      process.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
        changeOrigin: true,
        secure:      false,
      },
    },
  },

  build: {
    outDir:        'dist',
    sourcemap:     true,
    rollupOptions: {
      output: {
        // Chunk strategy: vendor libs in a separate chunk for better caching.
        manualChunks: {
          'react-vendor':  ['react', 'react-dom', 'react-router-dom'],
          'query-vendor':  ['@tanstack/react-query'],
          'ui-vendor':     ['lucide-react', 'clsx'],
        },
      },
    },
  },
});
