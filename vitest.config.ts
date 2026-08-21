import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Native-only plugin bundle isn't Node/jsdom-safe to import — see the
      // stub file for details.
      'capacitor-razorpay': path.resolve(__dirname, 'src/test/mocks/capacitor-razorpay.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
