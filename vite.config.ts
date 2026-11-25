import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 7000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@mlc-ai/web-llm')) {
              return 'vendor-web-llm';
            }
            if (id.includes('@xyflow')) {
              return 'vendor-xyflow';
            }
            if (id.includes('recharts') || id.includes('d3-')) {
              return 'vendor-recharts';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-lucide';
            }
            if (id.includes('zod')) {
              return 'vendor-zod';
            }
            return 'vendor-core';
          }
        }
      }
    }
  }
});
