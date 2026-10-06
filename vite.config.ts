import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  publicDir: 'public',
  worker: { format: 'es' },
  build: isSsrBuild
    ? { outDir: 'dist/server', emptyOutDir: true, copyPublicDir: false, target: 'node22' }
    : { outDir: 'dist/client', emptyOutDir: true, assetsInlineLimit: 0 }
}));
