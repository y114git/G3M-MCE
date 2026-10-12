import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/G3M-MCE/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rolldownOptions: { output: { codeSplitting: false } },
  },
  test: { include: ['src/**/*.test.js'] },
});
