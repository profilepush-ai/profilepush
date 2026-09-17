import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pin the dev server. Vite's default is 5173 but it silently increments to
  // 5174, 5175... when the port is busy (usually a dev server left running),
  // which moves the app out from under bookmarks and any OAuth redirect URI
  // registered against 5173. strictPort makes that collision an error you can
  // see and fix instead of a quiet port change.
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
});
